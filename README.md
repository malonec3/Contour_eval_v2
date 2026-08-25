# RadOnc Contour Metrics Lab

A browser-only TypeScript/React recreation of the original Streamlit teaching app. Students can explore synthetic contours or draw a reference and test contour, transform them, and compare 2D overlap and surface-distance metrics. All calculations run locally in each student's browser—there is no shared Python server or per-class concurrency bottleneck.

## Included metrics

- DICE coefficient, Jaccard index, and area ratio
- Symmetric surface DICE at a configurable tolerance
- Bidirectional mean surface distance
- Configurable-percentile and maximum Hausdorff distance
- Added path length (APL), including wrap-around segments and interpolated threshold crossings
- Analytic circle overlap for clean synthetic circles; rasterised overlap for noisy or hand-drawn polygons
- Arc-length resampling for robust surface comparisons

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

The coordinate plane spans −10 to +10 on each axis. Region overlap for hand-drawn/noisy contours uses a 256 × 256 point-in-polygon mask. Surface contours are resampled at equal arc-length intervals before nearest-neighbour calculations, reducing sensitivity to where vertices were clicked. The Hausdorff percentile is calculated in both directions and the larger directional value is reported. APL is directional by definition: it measures the length of the **test** contour beyond tolerance from the reference contour.

CT images are illustrative backgrounds only. Their displayed centimetre scale is relative and is not calibrated to DICOM pixel spacing.

## Educational notice

This application is for education and demonstration, not clinical decision-making. Metric acceptability is anatomy-, task-, resolution-, and institution-dependent.

CC BY-NC-SA 4.0 · Ciaran Malone
