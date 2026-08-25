# RadOnc Contour Metrics Lab

A browser-only TypeScript/React recreation of the original Streamlit teaching app. Students can explore synthetic contours or draw a reference and test contour, transform them, and compare 2D overlap and surface-distance metrics. All calculations run locally in each student's browser—there is no shared Python server or per-class concurrency bottleneck.

## Included metrics

- DICE coefficient, Jaccard index, and area ratio
- Arc-length-weighted symmetric surface DICE at a configurable tolerance
- Arc-length-weighted bidirectional mean surface distance
- Configurable-percentile and maximum Hausdorff distance
- Reference added path length (APL), opposite-direction test excess path, and their bidirectional total
- Continuous simple-polygon overlap geometry for synthetic and hand-drawn contours
- Point-to-segment surface distances with arc-length resampling and interpolated threshold crossings

## Run locally

Use Node.js 22 or later.

```bash
npm ci
npm run test:github
npm run dev
```

For a plain static preview matching GitHub Pages:

```bash
npm run build:github
npx vite preview --outDir dist-github
```

## Deploy free on GitHub Pages

1. Create a GitHub repository and push this project to its `main` branch.
2. In the repository, open **Settings → Pages**.
3. Under **Build and deployment**, choose **GitHub Actions** as the source.
4. The included `.github/workflows/deploy-pages.yml` workflow tests, builds, and deploys the app on every push to `main`.

The Vite configuration automatically detects the repository name, so images and scripts work at `https://YOUR-NAME.github.io/REPOSITORY/` without editing paths.

## Metric implementation notes

Region areas and intersections are calculated from the complete contour polygons rather than a pixel mask. Concave simple polygons are triangulated and the triangle intersections are clipped geometrically. Self-intersecting contours are rejected because they do not define an unambiguous filled region. Synthetic contours always use the same 360-point polygon method, including when noise is zero, so changing noise does not switch algorithms.

Surface contours are sampled at equal arc-length intervals while retaining original vertices so sharp corners are not cut off. Each sample is projected onto the nearest segment of the opposite contour. Surface DICE and mean surface distance integrate along arc length rather than giving every sampled point equal weight. The Hausdorff percentile is calculated in both directions and the larger directional value is reported.

APL follows the reference-ground-truth convention: it is the length of the **reference** contour lying beyond tolerance from the test contour. The reverse direction is labelled **test excess path**, and the app also reports their sum. The same floating-point tolerance is used for threshold classification in the calculations and plots.

The coordinate plots span −10 to +10 on each axis, but that range is a display window only. Metrics use the complete contour geometry and the app warns when a contour extends beyond the visible field.

CT images are illustrative backgrounds only. Their displayed centimetre scale is relative and is not calibrated to DICOM pixel spacing.

## Educational notice

This application is for education and demonstration, not clinical decision-making. Metric acceptability is anatomy-, task-, resolution-, and institution-dependent.

CC BY-NC-SA 4.0 · Ciaran Malone
