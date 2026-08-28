# RadOnc Contour Metrics Lab

## Included metrics

- DICE coefficient, Jaccard index, and area ratio
- Arc-length-weighted symmetric surface DICE at a configurable tolerance
- Arc-length-weighted bidirectional mean surface distance
- Configurable-percentile and maximum Hausdorff distance
- Reference added path length (APL), opposite-direction test excess path, and their bidirectional total
- Continuous simple-polygon overlap geometry for synthetic and hand-drawn contours
- Point-to-segment surface distances

## Metric implementation notes

Region areas and intersections are calculated from the complete contour polygons rather than a pixel mask. 

Surface contours are sampled at equal arc-length intervals while retaining original vertices so sharp corners are not cut off. Each sample is projected onto the nearest segment of the opposite contour. Surface DICE and mean surface distance integrate along arc length rather than giving every sampled point equal weight. The Hausdorff percentile is calculated in both directions and the larger directional value is reported.

APL follows the reference-ground-truth convention: it is the length of the **ground-truth boundary path** not captured within tolerance by the test contour. It is therefore the path that must be added when correcting the test, not a path requiring correction on the reference itself. The reverse direction is labelled **test excess path**, and the app also reports their sum. The same floating-point tolerance is used for threshold classification in the calculations and plots.

The coordinate plots span −10 to +10 on each axis, but that range is a display window only. Metrics use the complete contour geometry and the app warns when a contour extends beyond the visible field.

CT images are illustrative backgrounds only. Their displayed centimetre scale is relative and is not calibrated to DICOM pixel spacing.

## Educational notice

This application is for education and demonstration, not clinical decision-making. Metric acceptability is anatomy-, task-, resolution-, and institution-dependent.

CC BY-NC-SA 4.0 · Ciaran Malone
