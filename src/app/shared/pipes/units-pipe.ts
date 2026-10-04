import { Pipe, PipeTransform } from '@angular/core';
import { formatUnits } from '../../core/utils/token-amount';

/** `{{ supply | units: 18 }}` → "1,000,000" — exact, every digit (smallest units → tokens). */
@Pipe({ name: 'units' })
export class UnitsPipe implements PipeTransform {
  transform(value: bigint | null | undefined, decimals: number): string {
    return value == null ? '' : formatUnits(value, decimals);
  }
}

/** `{{ fee | mas }}` → "1.5 MAS" from nanoMAS. */
@Pipe({ name: 'mas' })
export class MasPipe implements PipeTransform {
  transform(value: bigint | null | undefined): string {
    return value == null ? '' : `${formatUnits(value, 9)} MAS`;
  }
}
