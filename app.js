const express = require("express");
const app = express();
const path = require('path');

const data = require("./public/data/data.json");
const keuzes = require("./public/data/keuzes.json");

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'public/views'));

app.use(express.static(path.join(__dirname, "public")));
app.use('/css', express.static(path.join(__dirname, 'public/css')));
app.use('/js',  express.static(path.join(__dirname, 'public/js')));
app.use('/img', express.static(path.join(__dirname, 'public/img')));
app.use('/leafletcss', express.static(path.join(__dirname, 'public/css/leaflet')));
app.use('/leafletjs', express.static(path.join(__dirname, 'public/js/leaflet')));

app.get('/', toonIndex);

function toonIndex (req, res) {
    res.render("pages/index");
}

app.get('/api/keuzes', (req, res) => {
    res.json(keuzes);
});

app.get('/api/data', (req, res) => {
    res.json(data)
})


module.exports = app;

if (process.env.VERCEL !== '1') {
  const server = app.listen(3000, '0.0.0.0', () =>
    console.log('http://localhost:3000')
  );
}