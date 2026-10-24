// Holder discount (v1.4.0): whoever holds at least one NFT of the collection the admin names
// pays the platform fees less `bps` — token, collection and import fees, and the presale and
// marketplace fees fixed when a presale or a listing is created. Never the deposit or storage.
//
// Holding is read from the collection's standard MRC721 balance key (0x03 + address) when the
// fee is charged, so no foreign code runs. An NFT can change hands between calls: the discount
// follows whoever holds it at that moment.
import { Args, stringToBytes, u16ToBytes } from '@massalabs/as-types';
import { Address, Storage, balance, createEvent, generateEvent } from '@massalabs/massa-as-sdk';
import { _onlyAdmin } from './common';
import { HOLDER_DISCOUNT_KEY, MRC721_BALANCE_PREFIX, MRC721_NAME_KEY, bytes } from './keys';
import { HolderDiscount } from './records';
import { MAX_HOLDER_DISCOUNT_BPS } from './rules';
import { settle } from './settlement';

/**
 * Args: collection (string, empty = no discount), bps (u16, 1-5000 when a collection is named).
 * Admin only.
 */
export function setHolderDiscount(binaryArgs: StaticArray<u8>): void {
  const before = balance();
  _onlyAdmin();
  const args = new Args(binaryArgs);
  const collection = args.nextString().expect('collection is missing or invalid');
  const bps = args.nextU16().expect('bps is missing or invalid');
  if (collection.length == 0) {
    if (Storage.has(HOLDER_DISCOUNT_KEY)) Storage.del(HOLDER_DISCOUNT_KEY);
  } else {
    assert(
      Storage.hasOf(new Address(collection), MRC721_NAME_KEY),
      'Not a standard MRC721 collection',
    );
    assert(bps > 0 && bps <= MAX_HOLDER_DISCOUNT_BPS, 'The discount must be 0.01-50%');
    Storage.set(HOLDER_DISCOUNT_KEY, new HolderDiscount(collection, bps).serialize());
  }
  generateEvent(createEvent('HOLDER_DISCOUNT_UPDATED', [collection, bps.toString()]));
  settle(before, 0);
}

/** Returns HolderDiscount, or empty bytes when there is none. */
export function holderDiscount(_: StaticArray<u8>): StaticArray<u8> {
  return Storage.has(HOLDER_DISCOUNT_KEY)
    ? Storage.get(HOLDER_DISCOUNT_KEY)
    : new StaticArray<u8>(0);
}

/** Args: address (string). Returns u16: the discount it gets now, in basis points (0 = none). */
export function getHolderDiscount(binaryArgs: StaticArray<u8>): StaticArray<u8> {
  const address = new Args(binaryArgs).nextString().expect('address is missing or invalid');
  return u16ToBytes(_discountBps(address));
}

/** The discount `account` gets now: the configured bps if it holds an NFT of the collection. */
export function _discountBps(account: string): u16 {
  if (!Storage.has(HOLDER_DISCOUNT_KEY)) return 0;
  const discount = new Args(Storage.get(HOLDER_DISCOUNT_KEY))
    .nextSerializable<HolderDiscount>()
    .unwrap();
  const key = bytes(MRC721_BALANCE_PREFIX).concat(stringToBytes(account));
  const collection = new Address(discount.collection);
  if (!Storage.hasOf(collection, key)) return 0;
  // A u256 balance; a holder who sold everything keeps the key with zero.
  const amount = Storage.getOf(collection, key);
  for (let i = 0; i < amount.length; i++) if (amount[i] != 0) return discount.bps;
  return 0;
}

/** The platform fee `account` pays, in nanoMAS. */
export function _feeFor(fee: u64, account: string): u64 {
  return _lessDiscount(fee, _discountBps(account));
}

/** The platform fee in basis points fixed for `account` (presale, listing). */
export function _feeBpsFor(feeBps: u16, account: string): u16 {
  return _lessDiscountBps(feeBps, _discountBps(account));
}

/** A fee in nanoMAS less `bps` of it (the discount is rounded down). */
export function _lessDiscount(fee: u64, bps: u16): u64 {
  return fee - ((fee / 10_000) * u64(bps) + ((fee % 10_000) * u64(bps)) / 10_000);
}

/** A fee in basis points less `bps` of it (the discount is rounded down). */
export function _lessDiscountBps(feeBps: u16, bps: u16): u16 {
  return feeBps - u16((u32(feeBps) * u32(bps)) / 10_000);
}
