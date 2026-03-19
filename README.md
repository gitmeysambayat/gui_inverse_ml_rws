# Inverse ML predictions for circular RWS connections

This is a fully static GitHub Pages bundle for inverse ML predictions of circular reduced web section connections.

## What this revision changes

- Inputs are now treated as **minimum targets** rather than exact matching values.
- The interface uses:
  - Profile
  - Steel grade
  - Span-to-depth ratio `2L/h`
  - Minimum target `M_y`
  - Minimum target `M_c`
  - Minimum target `M_u`
  - Minimum target `θ_u`
  - Preferred `J1`, `J2`, or `J3` filter
- `M_c` is never allowed below `M_y`.
- `M_u` is never allowed above `M_c`.
- The inverse ML model predicts continuous `d_o/h` and `S/h`.
- The returned recommendation is the **best FE-backed opening case in the selected beam context** that satisfies the chosen J-screen and the user minimum targets, or the nearest miss when no feasible case exists.
- Backbone curves come from the exact FE backbone CSV.
- Contour images use the same public contour repository structure as the forward GUI.

## Inverse ML model

The browser-side inverse ML model was retrained on the 7,500 opening cases using a 70% train and 30% test split.

Feature set used in the browser model:

- `h (mm)`
- `b (mm)`
- `tw (mm)`
- `tf (mm)`
- `fy (MPa)`
- `2L/h`
- `My_FS_ratio = My / My_FS`
- `Mc_FS_ratio = Mc / Mc_FS`
- `Mu_Mc = Mu / Mc`
- `theta_u_target`
- `Omega_s = Mc / My`

Test metrics are stored in:

- `assets/xgb_strength_theta_inverse_metrics.json`

## J-criteria logic

The interface uses the updated Chapter 5 definitions supplied by the thesis author:

- `J1 = P[(M0.04 ≥ 0.8 Mp) ∩ (θu ≥ 4%)]`
- `J2 = P[(M0.04 ≥ 0.8 Mp) ∩ (θu ≥ 4%) ∩ (σvm,CF/Fy ≤ 1) ∩ (PEEQCF ≈ 0.0)]`
- `J3 = P[(M0.04 ≥ 0.8 Mp) ∩ (θu ≥ 4%) ∩ (σvm,CF/Fy ≤ 1) ∩ (PEEQCF ≈ 0.0) ∩ (Mc ≥ 0.8 Mc,FS)]`

## Conservative handling of `Mu` and `θu`

When the 20% strength degradation point is reached within the analysed drift range:

- `Mu = 0.8 Mc`
- `θu` is taken from the exact drop point

When the 20% drop is **not** reached by 6% drift:

- `Mu` is shown conservatively as `M0.06`
- `θu` is shown as a lower bound of `0.06 rad`

## Publish with GitHub Pages

Copy the contents of this folder into the repository root, commit, push, and enable GitHub Pages from `main` and `/(root)`.
