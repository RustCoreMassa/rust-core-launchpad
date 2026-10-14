import { stripHidden } from './hidden-chars';

describe('hidden characters', () => {
  it('removes bidi controls and invisible characters', () => {
    expect(stripHidden('My‮CSDU')).toBe('MyCSDU');
    expect(stripHidden('⁦Cat⁩ ​Club﻿')).toBe('Cat Club');
    expect(stripHidden('‎‏؜')).toBe('');
  });

  it('keeps ordinary text, accents and emoji', () => {
    expect(stripHidden('Ștefan’s café 🐱‍👤')).toBe('Ștefan’s café 🐱‍👤');
  });
});
