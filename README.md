# Inverse ML for circular RWS connection predictions

This folder is a fully static GitHub Pages bundle for inverse ML prediction of circular reduced web section connections.

## What is included

- `index.html` — interface shell
- `styles.css` — styling
- `app.js` — browser-side inverse ML logic and Chapter 5 screening logic
- `assets/inverse_candidates.json` — exact FE-backed candidate data for all 75 beam contexts
- `assets/inverse_meta.json` — slider ranges, section properties and ranking presets
- `assets/xgb_inverse_doh_dump.json` — exported XGBoost tree dump for `d_o/h`
- `assets/xgb_inverse_Sh_dump.json` — exported XGBoost tree dump for `S/h`

## What changed in this revision

- The interface title was changed to **Inverse ML for circular RWS connection predictions**.
- The language of “design” was removed from the main interface and replaced by “prediction”.
- The Chapter 5 screening criteria are embedded directly in the online interface:
  - **J1**: `M0.04/Mp ≥ 0.8`
  - **J2**: `J1` and `σvm,CF/fy ≤ 1.0`
  - **J3(τ)**: `J2` and `PEEQCF ≤ τ`, with `τ = 0.05` as the default thesis value
- The site now reports context-specific J1, J2 and J3 satisfaction rates across the 100 FE-backed opening geometries in the selected beam context.
- The ranked candidate list is criterion-aware. If J1, J2 or J3 is active, the interface screens the ranked results by that criterion whenever at least one geometry in the selected beam context satisfies it.
- Browser-side XGBoost inference remains active, so the site still behaves as a lightweight online app without a backend server.

## Publishing it online with GitHub Pages

This bundle is already suitable for a click-through public URL like your existing GUI.

1. Create a GitHub repository for the inverse ML interface.
2. Copy the contents of this folder into the repository root.
3. Commit and push.
4. In the repository settings, enable **GitHub Pages** from the `main` branch root.
5. GitHub Pages will publish the site at:

   `https://<your-github-username>.github.io/<repository-name>/`

Because the application is static and runs entirely in the browser, anyone with the link can use it without installing anything.

## Notes

- There is no backend dependency.
- The online behaviour is the same class of deployment as a standard GitHub Pages site.
- Inputs are restricted to the trained data domain through fixed beam contexts and bounded target ranges.
