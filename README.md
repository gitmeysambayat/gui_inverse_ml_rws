# Inverse ML predictions for circular RWS connections

This GitHub Pages bundle rebuilds the inverse interface around the strength-side inverse problem that matches the forward RWS explorer more closely.

## What this version does

- fixes the backbone display by using the exact FE backbone ordinates from the thesis dataset
- uses beam context plus target strengths `My` and `Mc` as the main inverse inputs
- returns the best opening geometry `d_o/h` and spacing `S/h` in two ways:
  - a continuous inverse ML estimate from browser-side XGBoost
  - the nearest FE-backed opening cases in the selected beam context
- keeps the Chapter 5 `J1`, `J2`, and `J3` screening logic
- shows the exact FE contour images for the selected case by linking to the contour-image repository already used by the forward GUI

## Main logic

1. The user selects the beam context: profile, grade, and `2L/h`.
2. The user enters target strengths `My` and `Mc`.
3. The inverse ML model estimates continuous `d_o/h` and `S/h`.
4. The FE-backed opening cases in the same context are ranked by exact mismatch in `My` and `Mc`.
5. The selected FE case shows:
   - exact backbone curve
   - `J1`, `J2`, and `J3`
   - von Mises contour image
   - PEEQ contour image

## Files

- `index.html` — interface shell
- `styles.css` — layout and styling
- `app.js` — browser-side inverse ML and FE ranking logic
- `assets/inverse_meta.json` — metadata, beam properties, context ranges, rotation grid
- `assets/inverse_candidates.json` — FE-backed opening cases and exact backbone curves
- `assets/xgb_inverse_doh_dump.json` — browser-side XGBoost model for `d_o/h`
- `assets/xgb_inverse_Sh_dump.json` — browser-side XGBoost model for `S/h`

## Publish

Copy the unzipped contents of this bundle into the root of the GitHub repository and publish with GitHub Pages from `main` and `/(root)`.
