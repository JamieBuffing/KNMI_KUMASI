const dataRAW = document.getElementById("boot-data");
const data = dataRAW ? JSON.parse(dataRAW.textContent) : { keuzes: {}, points: [] };
                                                                                              console.log(data)
const pointsNR = data.points.length;

const values = data.points.flatMap(p =>
  p.measurements
    .filter(m => typeof m.value === "number")
    .map(m => m.value)
);

const succeededValues = data.points.flatMap(p =>
  p.measurements
    .filter(m => typeof m.value === "number")
    .map(m => m.value)
);

const failedMeasurements = data.points.flatMap(p =>
  p.measurements.filter(m => m.noMeasurement === true || typeof m.value !== "number")
);

const measurementsNR = succeededValues.length + failedMeasurements.length;
const measurementsGoodNR = succeededValues.length;
const measurementsFaultyNR = failedMeasurements.length;

const lowestMeasurement = Math.min(...values);
const highestMeasurement = Math.max(...values);

const allMeasurements = data.points.flatMap(p =>
  p.measurements
    .filter(m => typeof m.value === "number")
    .map(m => ({
      point_number: p.point_number,
      location: p.location,
      date: m.date,
      value: m.value,
      tube_id: m.tube_id
    }))
);

const minData = allMeasurements.reduce((a, b) => (b.value < a.value ? b : a));
const maxData = allMeasurements.reduce((a, b) => (b.value > a.value ? b : a));

const measurementYears = new Set(
  data.points.flatMap(p =>
    p.measurements.map(m =>
      new Date(m.date).getUTCFullYear()
    )
  )
);

const yearRange = measurementYears.size;

const statPoints = document.getElementById("statPoints")
const statMeasurements = document.getElementById("statMeasurements")
const statMeasurementsGood = document.getElementById("statMeasurementsGood")
const statMeasurementsFaulty = document.getElementById("statMeasurementsFaulty")
const statLow = document.getElementById("statLow")
const statHigh = document.getElementById("statHigh")
const statYears = document.getElementById("statYears")


statPoints.textContent = pointsNR
statMeasurements.textContent = measurementsNR
statMeasurementsGood.textContent = measurementsGoodNR
statMeasurementsFaulty.textContent = measurementsFaultyNR
statLow.textContent = lowestMeasurement
statHigh.textContent = highestMeasurement
statYears.textContent = yearRange

const batchInput = document.getElementById("batchInput")
const measurementPoints = document.getElementById("batchpoints")

data.points.forEach(point => {
  if(point.active == false) {
    return
  }
  const article = document.createElement("article");
  article.dataset.pointNumber = point.point_number;

  const h3 = document.createElement("h3");
  h3.textContent = point.location;

  const labelTubeID = document.createElement("label");
  labelTubeID.textContent = "Tube ID";
  labelTubeID.classList.add("bold")

  const labelValue = document.createElement("label");
  labelValue.textContent = "Value (µg/m³)";
  labelValue.classList.add("bold")

  const inputTube = document.createElement("input");
  inputTube.type = "text";
  inputTube.name = `inputTube_${point.point_number}`;
  inputTube.placeholder = point.measurements?.[0]?.tube_id || "B3";
  inputTube.required = true;

  const inputValue = document.createElement("input");
  inputValue.type = "number";
  inputValue.step = "1";
  inputValue.name = `inputValue_${point.point_number}`;
  inputValue.placeholder = point.measurements?.[0]?.value || "23.35";
  inputValue.required = true;

  const labelNMP = document.createElement("label");
  labelNMP.className = "batchNoMeasurement";

  const inputNMP = document.createElement("input");
  inputNMP.type = "checkbox";
  inputNMP.className = "NMP";
  inputNMP.name = `nmp_${point.point_number}`;

  const spanNMP = document.createElement("span");
  spanNMP.textContent = "No measurement possible";
  spanNMP.classList.add("bold")

  labelNMP.append(inputNMP, spanNMP);

  inputNMP.addEventListener("change", () => {
    inputValue.disabled = inputNMP.checked;
    if (inputNMP.checked) inputValue.value = "";
  });

  article.append(h3, labelTubeID, labelValue, inputTube, inputValue, labelNMP);
  batchInput.append(article);
});

data.points.forEach(point => {
  const article = document.createElement("article");
  article.dataset.pointNumber = point.point_number;

  const h3 = document.createElement("h3");
  h3.textContent = point.location || "Location unknown";

  const status = document.createElement("span");
  status.textContent = point.active ? "active" : "inactive";

  const p3 = document.createElement("p");
  p3.className = "div3";
  p3.textContent = "Coordinates";
  p3.classList.add("bold")

  const p4 = document.createElement("p");
  p4.className = "div4";
  p4.textContent = "City";
  p4.classList.add("bold")

  const p5 = document.createElement("p");
  p5.className = "div5";
  p5.innerHTML = `<span class="bold">Lat: </span>${point.coordinates.lat.toFixed(4)}`;

  const p6 = document.createElement("p");
  p6.className = "div6";
  p6.innerHTML = `<span class="bold">Lon: </span>${point.coordinates.lon.toFixed(4)}`

  const p7 = document.createElement("p");
  p7.className = "div7";
  p7.textContent = data.keuzes["Gekozen stad"];

  const p8 = document.createElement("p");
  p8.className = "div8";
  p8.textContent = "Measurements";
  p8.classList.add("bold")

  const p9 = document.createElement("p");
  p9.className = "div9";
  p9.textContent = "Period";
  p9.classList.add("bold")

  // aantal geslaagde metingen
  const succeeded = point.measurements.filter(m => typeof m.value === "number");

  const p10 = document.createElement("p");
  p10.className = "div10";
  p10.textContent = succeeded.length;

  // periode bepalen
  const dates = point.measurements
    .map(m => m.date)
    .filter(Boolean)
    .sort((a, b) => new Date(a) - new Date(b));

  const start = dates[0];
  const end = dates[dates.length - 1];

  const p11 = document.createElement("p");
  p11.className = "div11";
  p11.textContent = start && end
    ? `${start.slice(0, 7)} to ${end.slice(0, 7)}`
    : "–";

  const formEdit = document.createElement("form");
  formEdit.className = "div12";
  formEdit.action = `/editpoint?point=${point.point_number}`;
  formEdit.method = "post";

  const btnEdit = document.createElement("button");
  btnEdit.type = "submit";
  btnEdit.textContent = "Edit";
  formEdit.append(btnEdit);

  const formDeactivate = document.createElement("form");
  formDeactivate.className = "div13";
  formDeactivate.action = `/togglepoint?point=${point.point_number}`;
  formDeactivate.method = "post";

  const btnDeactivate = document.createElement("button");
  btnDeactivate.type = "submit";
  btnDeactivate.textContent = point.active ? "Deactivate" : "Activate";

  formDeactivate.append(btnDeactivate);


  article.append(
    h3,
    status,
    p3, p4, p5, p6, p7,
    p8, p9, p10, p11,
    formEdit,
    formDeactivate
  );

  measurementPoints.append(article);
});
