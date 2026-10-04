// Deploys build/launchpad.wasm. Network from NETWORK (buildnet by default — mainnet only on
// purpose), deployer key from PRIVATE_KEY in .env (see .env.example). The deployer becomes the
// Launchpad admin.
import 'dotenv/config';
import { Account, Args, JsonRpcProvider, Mas, SmartContract } from '@massalabs/massa-web3';
import { getScByteCode } from './utils';

const network = process.env['NETWORK'] === 'mainnet' ? 'mainnet' : 'buildnet';
const account = await Account.fromEnv();
const provider =
  network === 'mainnet' ? JsonRpcProvider.mainnet(account) : JsonRpcProvider.buildnet(account);

console.log(`Deploying launchpad.wasm to ${network} from ${account.address.toString()}…`);

const contract = await SmartContract.deploy(
  provider,
  getScByteCode('build', 'launchpad.wasm'),
  new Args(),
  { coins: Mas.fromString('0.1') },
);

console.log('Launchpad deployed at:', contract.address);
for (const event of await provider.getEvents({ smartContractAddress: contract.address })) {
  console.log('Event:', event.data);
}
