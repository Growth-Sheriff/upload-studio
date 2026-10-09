# Public finished-sheet contract

1. The upload is a finished production file; no layout/nesting step exists.
2. Choose a printable orientation consuming the least film; if only the short edge fits, it is width. Never accept genuine width overflow.
3. Variant pricing picks the shortest merchant variant covering billable length; no fit means rejection.
4. Measured-length pricing uses the merchant's explicit per-inch rate, printable width and length ceiling; no splitting above the ceiling.
5. Quantity prints the complete sheet that many times. Print Ready, Sheet Identity and DPI remain the only three cart properties.

Defaults are visible values: width22.5, custom length240, tolerance0.02 inches (editable0.01–0.03). No implicit copy gaps/artboard/image margins. DPI/header and vector policies are inherited; client dimensions never overrule server price validation. Product Setup saves the visible values rather than silently repricing a live tenant.

One inherited duplicate computation was corrected on this branch: the measured quote used max(width,height) even after the canonical orientation put the long side across the roll. A22x6 sheet fits across22.5 and consumes6 inches, not22; its rotated upload gives the same result. At0.30 per inch, two copies cost3.60 instead of13.20. A22x80 still consumes80. This does not change the orientation chooser, file bytes or custom production applications.

The legacy September regression fixture expected the short-sheet case to become22x24/$12, while the October baseline already resolves22x12/$6. The initial harness run exposed that stale expectation. The fixture now states the least-film policy explicitly; historical comparison prices were preserved, not hidden. The harness still compares against its original September reference and labels the earlier no-nesting/physical-fit corrections. Public-base pricing has separate capability/guest/account-precedence tests.
