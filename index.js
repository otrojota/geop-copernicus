global.confPath = __dirname + "/config.json";

let downloader = false;
let import1 = false, import2 = false;

for (let i=2; i<process.argv.length; i++) {
    let arg = process.argv[i].toLowerCase();
    if (arg == "-d" || arg == "-download" || arg == "-downloader") downloader = true;
    if (arg == "-import1" || arg == "-i1") import1 = true;
    if (arg == "-import2" || arg == "-i2") import2 = true;
}

if (import1) {
    importCHL();
    return;
}

if (!downloader && process.env.DOWNLOADER) {
    downloader = true;
}

const ProveedorCapasCopernicus = require("./lib/ProveedorCapasCopernicus");

if (downloader) {
    console.log("[Copernicus] Iniciando en modo Downloader");
    require("./lib/Downloader").init();
} else {
    const config = require("./lib/Config").getConfig();
    const proveedorCapas = new ProveedorCapasCopernicus({
        puertoHTTP:config.webServer.http.port,
        directorioWeb:__dirname + "/www",
        directorioPublicacion:config.publishPath
    });
    proveedorCapas.start();
}

async function importCHL() {
    const moment = require("moment-timezone");
    const downloader = require("./lib/Downloader");
    const config = require("./lib/Config").getConfig();
    let time = moment.tz("UTC");
    time.hours(0); time.minutes(0); time.seconds(0);
    time = time.subtract(1, "days");
    let producto = config.productos.find(p => p.codigo == "CHL_L4");
    while (true) {
        await downloader.descargaProducto(producto, {}, time);
        time = time.subtract(1, "days");
    }
}