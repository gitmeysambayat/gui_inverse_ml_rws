# Inverse ML predictions for circular RWS connections

This folder is a fully static GitHub Pages bundle for inverse ML predictions for circular reduced web section connections.

## Preview

A representative static preview image is included as `gui_preview.png`.

## What is included

- `gui_preview.png` — representative interface preview used in the thesis chapter
- `index.html` — interface shell
- `styles.css` — styling
- `app.js` — browser-side inverse ML logic and updated Chapter 5 screening logic
- `assets/inverse_candidates.json` — exact FE-backed candidate data for all 75 beam contexts
- `assets/inverse_meta.json` — slider ranges, section properties and ranking presets
- `assets/xgb_inverse_doh_dump.json` — exported XGBoost tree dump for `d_o/h`
- `assets/xgb_inverse_Sh_dump.json` — exported XGBoost tree dump for `S/h`

## Chapter 5 screening logic in this revision

The interface now follows the updated definitions you supplied:

- **J1** = P[(M0.04 ≥ 0.8 Mp) ∩ (θu ≥ 4%)]
- **J2** = P[(M0.04 ≥ 0.8 Mp) ∩ (θu ≥ 4%) ∩ (σvm,CF/Fy ≤ 1) ∩ (PEEQCF ≈ 0.0)]
- **J3** = P[(M0.04 ≥ 0.8 Mp) ∩ (θu ≥ 4%) ∩ (σvm,CF/Fy ≤ 1) ∩ (PEEQCF ≈ 0.0) ∩ (Mc ≥ 0.8 Mc,FS)]

Implementation notes:

- `θu` is used directly for J-screening when it exists; when the explicit `θu` value is censored by the analysed rotation range, the interface falls back to `θu,LB` so that clearly non-degraded cases are not misclassified.
- `Mc,FS` is taken from the full-section reference case `C100` within the same `(Profile, Grade, 2L/h)` context.
- `PEEQCF ≈ 0.0` is implemented as `PEEQCF = 0.0` within a tiny numerical tolerance to avoid floating-point edge noise.

## Publishing it online with GitHub Pages

This bundle is already suitable for a click-through public URL like your existing GUI.

1. Copy the contents of this folder into the repository root.
2. Commit and push.
3. In the repository settings, enable **GitHub Pages** from the `main` branch root.
4. GitHub Pages will publish the site at:

   `https://<your-github-username>.github.io/<repository-name>/`

Because the application is static and runs entirely in the browser, anyone with the link can use it without installing anything.

## Notes

- There is no backend dependency.
- Inputs are restricted to the trained data domain through fixed beam contexts and bounded target ranges.
- The ranked candidate list is criterion-aware. If J1, J2 or J3 is active, the interface screens the ranked results by that criterion whenever at least one geometry in the selected beam context satisfies it.
