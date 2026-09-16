import { describe, expect, it } from 'vitest'
import { preserveStoredProductMargins } from './productBuilderConfig.server'

describe('preserveStoredProductMargins', () => {
  it('keeps legacy missing margins at zero during unrelated product saves', () => {
    expect(
      preserveStoredProductMargins(
        { artboardMarginIn: 0.125, imageMarginIn: 0.125, maxWidthIn: 22 },
        { maxWidthIn: 22 },
        true
      )
    ).toMatchObject({ artboardMarginIn: 0, imageMarginIn: 0, maxWidthIn: 22 })
  })

  it('keeps explicitly stored margins and leaves new configurations alone', () => {
    expect(
      preserveStoredProductMargins(
        { artboardMarginIn: 0.125, imageMarginIn: 0.125 },
        { artboardMarginIn: 0.2, imageMarginIn: 0.3 },
        true
      )
    ).toMatchObject({ artboardMarginIn: 0.2, imageMarginIn: 0.3 })
    expect(
      preserveStoredProductMargins(
        { artboardMarginIn: 0.125, imageMarginIn: 0.125 },
        null,
        false
      )
    ).toMatchObject({ artboardMarginIn: 0.125, imageMarginIn: 0.125 })
  })
})
