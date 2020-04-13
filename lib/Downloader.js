const fs = require('fs');
const moment = require("moment-timezone");
const config = require("./Config").getConfig();
const motuClient = require("./MOTUClient");
const gdal = require("./GDAL");

class Downloader {
    constructor() {
        this.pathEstado = require("./Config").getConfig().dataPath + "/estado.json";
    }
    static get instance() {
        if (!Downloader.singleton) Downloader.singleton = new Downloader();
        return Downloader.singleton;
    }

    getEstado() {
        return new Promise((resolve, reject) => {
            fs.readFile(this.pathEstado, (err, data) => {
                if (err) {
                    if (err.code == "ENOENT") resolve(null);
                    else reject(err);
                } else resolve(JSON.parse(data));
            })
        });
    }
    setEstado(estado) {
        return new Promise((resolve, reject) => {
            fs.writeFile(this.pathEstado, JSON.stringify(estado), err => {
                if (err) reject(err);
                resolve();
            })
        })
    }

    init() {
        this.callBuscador(1000);
    }
    callBuscador(ms) {
        if (!ms) ms = 60000 * 30;
        if (this.timer) clearTimeout(this.timer);
        this.timer = setTimeout(_ => {
            this.timer = null;
            this.descarga()
        }, ms);
    }

    
    async descarga() {       
        try {
            let estado = await this.getEstado();
            if (!estado) estado = {};
            let ahora = moment.tz("UTC");
            
            for (let i=0; i<config.productos.length; i++) {
                let nTries = 0, success = false;
                do {
                    try {
                        console.log("Producto: " + config.productos[i].codigo + ". Intento: " + (nTries + 1));
                        await this.descargaProducto(config.productos[i], estado, ahora);
                        console.log("  => OK");
                        success = true;
                    } catch(error) {
                        console.error(error);
                        success = false;
                    }
                } while (!success && ++nTries < 5);
            }
            await this.setEstado(estado);
        } catch(error) {
            console.error(error);
        } finally {
            this.callBuscador();
        }
    }
    
    ajustaTiempoProducto(tiempo, producto) {
        switch(producto.temporalidad) {
            case "dia-anterior":
            case "dia-anterior-12":
                let ayer = tiempo.clone();
                ayer = ayer.subtract(1, "days");
                ayer.hours(0); ayer.minutes(0); ayer.seconds(0);
                return ayer;
            default:
                throw "Temporalidad '" + producto.temporalidad + "' no manejada";
        }
    }
    mkdir(path) {
        return new Promise((resolve, reject) => {
            fs.mkdir(path, err => {
                if (err && err.code != "EEXIST") {
                    reject(err);
                    return;
                }
                resolve();
            });
        })
    }
    async descargaProducto(producto, estado, tiempo) {
        try {
            let fechaDescarga = this.ajustaTiempoProducto(tiempo, producto);
            let fmtFechaDescarga, outName;
            switch(producto.temporalidad) {
                case "dia-anterior":
                    fmtFechaDescarga = fechaDescarga.format("YYYY-MM-DD 00:00:00");
                    outName =  producto.codigo + "-" + fechaDescarga.format("YYYY-MM-DD_00");
                    break;
                case "dia-anterior-12":
                    fmtFechaDescarga = fechaDescarga.format("YYYY-MM-DD 12:00:00");
                    outName =  producto.codigo + "-" + fechaDescarga.format("YYYY-MM-DD_12");
                    break;
                default:
                    throw "Temporalidad no manejada '" + producto.temporalidad + "'";
            }
            if (estado[producto.codigo] == fmtFechaDescarga) return;            
            let outDir = config.dataPath + "/" + fechaDescarga.format("YYYY");
            await this.mkdir(outDir);
            outDir += "/" + fechaDescarga.format("MM");
            await this.mkdir(outDir);            
            try {
                console.log("Descargando '" + outDir + "/" + outName + ".nc' ...");
                await motuClient.download(producto, fmtFechaDescarga, outDir, outName + ".nc");
                estado[producto.codigo] = fmtFechaDescarga;
                console.log("  --> Archivo Descargado");
                // Construir metadata
                let metadata = {variables:{}};
                for (let i=0; i<producto.variables.length; i++) {
                    let variable = producto.variables[i];
                    let info = await gdal.info(outDir + "/" + outName + ".nc", true, (i+1));
                    let band = info.bands[0];
                    let m = {
                        subDataset:(i+1),
                        noDataValue:band.noDataValue,
                        unit:band.unit,
                        min:band.computedMin,
                        max:band.computedMax,
                        atributos:{}
                    };
                    let sdMetadata = info.metadata[""];
                    Object.keys(sdMetadata).forEach(key => {
                        if (key.startsWith(variable.codigo + "#")) {
                            let p = key.indexOf("#");
                            if (p >= 0) {
                                m.atributos[key.substring(p+1)] = sdMetadata[key];
                            }
                        }
                    });
                    m.modelo = sdMetadata["NC_GLOBAL#creation_date"] + " " + sdMetadata["NC_GLOBAL#creation_time"];
                    metadata.variables[variable.codigo] = m;
                }
                await new Promise((resolve, reject) => {
                    fs.writeFile(outDir + "/" + outName + ".metadata", JSON.stringify(metadata), err => {
                        if (err) reject(err);
                        resolve();
                    })
                })
            } catch(error) {
                console.error(error);
                throw error;
            }
        } catch(error) {
            throw error;
        }
    }
}

module.exports = Downloader.instance;