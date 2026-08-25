# RadOnc Contour Metrics Lab

## Included metrics

- DICE coefficient, Jaccard index, and area ratio
- Symmetric surface DICE at a configurable tolerance
- Bidirectional mean surface distance
- Configurable-percentile and maximum Hausdorff distance
- Added path length (APL), including wrap-around segments and interpolated threshold crossings
- Analytic circle overlap for clean synthetic circles; rasterised overlap for noisy or hand-drawn polygons
- Arc-length resampling for robust surface comparisons


## Metric implementation notes

The coordinate plane spans −10 to +10 on each axis. Region overlap for hand-drawn/noisy contours uses a 256 × 256 point-in-polygon mask. Surface contours are resampled at equal arc-length intervals before nearest-neighbour calculations, reducing sensitivity to where vertices were clicked. The Hausdorff percentile is calculated in both directions and the larger directional value is reported. APL is directional by definition: it measures the length of the **test** contour beyond tolerance from the reference contour.

CT images are illustrative backgrounds only. Their displayed centimetre scale is relative and is not calibrated to DICOM pixel spacing.

## Educational notice

This application is for education and demonstration, not clinical decision-making. Metric acceptability is anatomy-, task-, resolution-, and institution-dependent.

CC BY-NC-SA 4.0 · Ciaran Malone
