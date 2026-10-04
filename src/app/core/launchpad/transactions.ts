import { Injectable, inject } from '@angular/core';
import { Args, Operation, OperationStatus } from '@massalabs/massa-web3';
import { MassaReader } from '../massa/massa-reader';
import { WalletStore } from '../wallet/wallet-store';
import { contractReason } from './events';

export { contractReason, eventFields } from './events';

export interface ContractCall {
  target: string;
  func: string;
  args: Args;
  /** nanoMAS sent with the call (fee + storage); the Launchpad refunds what it doesn't use. */
  coins: bigint;
}

export interface CallResult {
  operationId: string;
  /** Event messages the call emitted, e.g. "TOKEN_CREATED:3,AS1…,AU1…". */
  events: string[];
}

export class OperationFailedError extends Error {
  constructor(
    readonly operationId: string,
    reason: string,
  ) {
    super(`Transaction failed: ${reason}`);
  }
}

export class OperationTimeoutError extends Error {
  constructor(readonly operationId: string) {
    super('Not confirmed yet — it may still go through. Check again in a minute.');
  }
}

/**
 * Every write the app makes: checks the wallet, runs the call read-only first (a failing call is
 * never sent for signing), has the wallet sign it, then waits until the chain executed it.
 * Pattern from RustCore Wallet: no optimistic updates — callers re-read after success.
 */
@Injectable({ providedIn: 'root' })
export class Transactions {
  private readonly wallet = inject(WalletStore);
  private readonly reader = inject(MassaReader);

  /** Read-only test run of the call as the connected account; throws the contract's error. */
  async simulate(call: ContractCall): Promise<void> {
    const caller = this.requireReady();
    const result = await this.reader.provider().readSC({
      target: call.target,
      func: call.func,
      parameter: call.args,
      coins: call.coins,
      caller,
    });
    if (result.info.error) throw new Error(contractReason(result.info.error));
  }

  async send(call: ContractCall): Promise<CallResult> {
    await this.simulate(call);
    const signer = this.wallet.signer();
    if (!signer) throw new Error('Connect a wallet first.');
    const operation = await signer.callSC({
      target: call.target,
      func: call.func,
      parameter: call.args,
      coins: call.coins,
    });
    const events = await waitExecuted(operation);
    void this.wallet.refreshBalance();
    return { operationId: operation.id, events };
  }

  private requireReady(): string {
    const address = this.wallet.address();
    if (!this.wallet.connected() || !address) throw new Error('Connect a wallet first.');
    if (this.wallet.networkMismatch())
      throw new Error('Switch your wallet to the network selected in the Launchpad.');
    return address;
  }
}

/** Waits for speculative execution and returns the events, or throws a typed error. */
export async function waitExecuted(operation: Operation): Promise<string[]> {
  const status = await operation.waitSpeculativeExecution();
  const events = await operation
    .getSpeculativeEvents()
    .then((list) => list.map((e) => e.data))
    .catch(() => [] as string[]);
  switch (status) {
    case OperationStatus.SpeculativeSuccess:
    case OperationStatus.Success:
      return events;
    case OperationStatus.SpeculativeError:
    case OperationStatus.Error:
      throw new OperationFailedError(operation.id, contractReason(events.at(-1) ?? ''));
    default:
      throw new OperationTimeoutError(operation.id);
  }
}
