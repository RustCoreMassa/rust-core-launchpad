import { Injectable, inject } from '@angular/core';
import { Args, JsonRpcPublicProvider } from '@massalabs/massa-web3';
import { MassaReader } from '../massa/massa-reader';

/** What an RC-Token reports through templateInfo(); absent on imported tokens. */
export interface TokenTemplateInfo {
  template: string;
  version: string;
  mintable: boolean;
  maxSupply: bigint;
  burnable: boolean;
  mutable: boolean;
}

export interface TokenState {
  totalSupply: bigint;
  /** Current owner; empty when ownership was renounced or the token has none. */
  owner: string;
  template: TokenTemplateInfo | null;
}

/** Live reads from a token contract (standard MRC20 functions + RC-Token's templateInfo). */
@Injectable({ providedIn: 'root' })
export class TokenReader {
  private readonly reader = inject(MassaReader);

  async state(address: string): Promise<TokenState> {
    const [supply, owner, template] = [
      await this.call(address, 'totalSupply'),
      await this.call(address, 'ownerAddress').catch(() => new Uint8Array()),
      await this.call(address, 'templateInfo').catch(() => null),
    ];
    return {
      totalSupply: new Args(supply).nextU256(),
      owner: new TextDecoder().decode(owner),
      template: template ? readTemplateInfo(template) : null,
    };
  }

  /** A function returning text, like name() or symbol(). */
  async text(address: string, func: string): Promise<string> {
    return new TextDecoder().decode(await this.call(address, func));
  }

  async balanceOf(address: string, holder: string): Promise<bigint> {
    return new Args(await this.call(address, 'balanceOf', new Args().addString(holder))).nextU256();
  }

  async allowance(address: string, owner: string, spender: string): Promise<bigint> {
    const bytes = await this.call(
      address,
      'allowance',
      new Args().addString(owner).addString(spender),
    );
    return new Args(bytes).nextU256();
  }

  async decimals(address: string): Promise<number> {
    return (await this.call(address, 'decimals'))[0];
  }

  /** sha256 (hex) of the contract's current bytecode, to compare with the original. */
  async codeHash(address: string): Promise<string> {
    const provider = this.reader.provider() as JsonRpcPublicProvider;
    const code = await provider.client.getAddressesBytecode({ address, is_final: true });
    const digest = await crypto.subtle.digest('SHA-256', code as Uint8Array<ArrayBuffer>);
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  }

  private async call(address: string, func: string, parameter = new Args()): Promise<Uint8Array> {
    const result = await this.reader.provider().readSC({ target: address, func, parameter });
    if (result.info.error) throw new Error(result.info.error);
    return result.value;
  }
}

export function readTemplateInfo(bytes: Uint8Array): TokenTemplateInfo {
  const args = new Args(bytes);
  return {
    template: args.nextString(),
    version: args.nextString(),
    mintable: args.nextBool(),
    maxSupply: args.nextU256(),
    burnable: args.nextBool(),
    mutable: args.nextBool(),
  };
}
