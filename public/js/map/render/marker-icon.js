export function createMarkerIcon(color) {
  return L.divIcon({
    className: "custom-marker",
    html: `<div style="
      width: 20px;
      height: 20px;
      background:${color};
      border-radius: 50%;
      border: 2px solid #FFFFFF;
      box-shadow: 0 0 4px #00000099;
    "></div>`,
    iconSize: [20, 20],
    iconAnchor: [10, 10]
  });
}
