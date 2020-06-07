const {ProveedorCapas, Origen, CapaRaster} = require("geop-base-proveedor-capas");
const config = require("./Config").getConfig();
const moment = require("moment-timezone");
const gdal = require("./GDAL");
const fsProm = require("fs").promises;
const fs = require("fs");
const PNG = require("pngjs").PNG;

class ProveedorCapasCopernicus extends ProveedorCapas {
    constructor(opciones) {
        super("copernicus", opciones);
        this.transformers = {};
        this.addOrigen("copernicus", "Copernicus Marine Service", "https://resources.marine.copernicus.eu/", "./img/copernicus.svg");
        config.productos.forEach(p => {
            p.variables.forEach(variable => {
                let opciones = {
                    codigoProducto:p.codigo,
                    formatos:{
                        isolineas:true, isobandas:true, serieTiempo:true, valorEnPunto:true, matrizRectangular:true
                    },
                    decimales:variable.decimales !== undefined?variable.decimales:2,
                    visualizadoresIniciales:variable.visualizadoresIniciales?variable.visualizadoresIniciales:undefined
                }
                if (variable.opacidad !== undefined) opciones.opacidad = variable.opacidad;
                this.addCapa(
                    new CapaRaster("copernicus", variable.codigo, variable.nombre, "copernicus", opciones, variable.grupos, variable.icono, variable.unidad, variable.niveles, variable.nivelInicial
                ));
                if (variable.transformer) {
                    this.transformers[variable.codigo] = variable.transformer;
                }
            });
        });
        config.vectores.forEach(vector => {
            let opciones = {
                formatos:{
                    isolineas:true, isobandas:true, serieTiempo:true, valorEnPunto:true, matrizRectangular:true, uv:true
                },
                decimales:vector.decimales !== undefined?vector.decimales:2,
                visualizadoresIniciales:vector.visualizadoresIniciales?vector.visualizadoresIniciales:undefined
            }
            if (vector.opacidad !== undefined) vector.opacidad = variable.opacidad;
            this.addCapa(
                new CapaRaster("copernicus", vector.codigo, vector.nombre, "copernicus", opciones, vector.grupos, vector.icono, vector.unidad, vector.niveles, vector.nivelInicial
            ));
        })

        setInterval(_ => this.eliminaArchivosPublicados(), 60000);
        this.eliminaArchivosPublicados();
    }

    async eliminaArchivosPublicados() {
        try {
            let dir = await fsProm.readdir(config.publishPath);
            let ahora = new Date().getTime();
            let limite = ahora - 60 * 1000;
            for (let i=0; i<dir.length; i++) {
                let path = config.publishPath + "/" + dir[i];
                let stats = await fsProm.stat(path);
                let t = stats.mtimeMs;
                if (t < limite) {
                    try {
                        await fsProm.unlink(path);
                    } catch(err) {
                        console.error("Eliminando archivo", err);
                    }
                }
            }
        } catch(error) {
            console.error(error);
        }
    }

    getPath(dt) {
        return config.dataPath + "/" + dt.format("YYYY") + "/" + dt.format("MM");
    }
    normalizaBBox(lng0, lat0, lng1, lat1) {
        let _lng0 = lng0, _lng1 = lng1, _lat0 = lat0, _lat1 = lat1;
        let limites = config.limites;
        if (_lng0 < limites.w) _lng0 = limites.w;
        if (_lng0 > limites.e) _lng0 = limites.e;
        if (_lng1 < limites.w) _lng1 = limites.w;
        if (_lng1 > limites.e) _lng1 = limites.e;
        if (_lat0 < limites.s) _lat0 = limites.s;
        if (_lat0 > limites.n) _lat0 = limites.n;
        if (_lat1 < limites.s) _lat1 = limites.s;
        if (_lat1 > limites.n) _lat1 = limites.n;
        return {lng0:_lng0, lat0:_lat0, lng1:_lng1, lat1:_lat1};
    }

    normalizaTiempoProducto(tiempo, producto) {
        switch(producto.temporalidad) {
            case "dia-anterior":
            case "dia-anterior-12":
                let t = tiempo.clone();
                t.hours(0); t.minutes(0); t.seconds(0);
                return t;
            default:
                throw "Temporalidad '" + producto.temporalidad + "' no manejada";
        }
    }

    getPathProducto(tiempo, producto) {
        let path = config.dataPath + "/" + tiempo.format("YYYY") + "/" + tiempo.format("MM") + "/" + producto.codigo + "-";
        switch(producto.temporalidad) {
            case "dia-anterior":
                return path + tiempo.format("YYYY-MM-DD") + "_00";
            case "dia-anterior-12":
                return path + tiempo.format("YYYY-MM-DD") + "_12";
            default: throw "Temporalidad '" + producto.temporalidad + "' no manejada";
        }
    }
    getMetadata(tiempo, producto) {
        return new Promise((resolve, reject) => {            
            let path = this.getPathProducto(tiempo, producto);
            fs.readFile(path + ".metadata", (err, data) => {
                let metadata = null;
                if (!err) {
                    metadata = JSON.parse(data);
                }
                resolve(metadata);
            });
        });
    }

    async findMetadata(tiempo, producto, codigoVariable) {  
        try {      
            let t0 = tiempo, t1, dt = 0;
            let unit, increment;
            switch(producto.temporalidad) {
                case "dia-anterior":
                case "dia-anterior-12":
                    unit = "days", increment = 1;
                    break;
                default: throw "Temporalidad '" + producto.temporalidad + "' no manejada";
            }
            do {
                t1 = t0.clone();
                t1.add(-dt, unit);
                let m = await this.getMetadata(t1, producto);
                if (m && m.variables[codigoVariable]) {
                    m.tiempo = t1.valueOf();
                    return m;
                }
                if (dt > 0) {
                    t1 = t0.clone();
                    t1.add(dt, unit);
                    m = await this.getMetadata(t1, producto);
                    if (m && m.variables[codigoVariable]) {
                        m.tiempo = t1.valueOf();
                        return m;
                    }
                }
                dt += increment;            
            } while ((t1.valueOf() - t0.valueOf()) < 48 * 60 * 60 * 1000);
            return null;
        } catch(error) {
            console.error(error);
            throw error;
        }
    }

    aplicaTransformacion(codigoVariable, v) {
        let transformer = this.transformers[codigoVariable];
        if (!transformer) return v;
        if (transformer) {
            switch(transformer) {
                case "K=>C":
                    return v - 273.15;
                default:
                    throw "Trandformador '" + transformer + "' no implementado";
            }
        }
    }

    getVector(codigoVariable) {
        return config.vectores.find(v => v.codigo == codigoVariable);
    }
    esVector(codigoVariable) {return this.getVector(codigoVariable)?true:false}

    async getPreconsulta(codigoCapa, lng0, lat0, lng1, lat1, tiempo, nivel, maxWidth, maxHeight) {
        try {
            if (this.esVector(codigoCapa)) return await this.getPreconsultaVector(codigoCapa, lng0, lat0, lng1, lat1, tiempo, nivel, maxWidth, maxHeight);
            let capa = this.getCapa(codigoCapa);            
            if (!capa) throw "No se encontró la capa '" + codigoCapa + "'";
            let codigoProducto = capa.opciones.codigoProducto;
            let producto = config.productos.find(p => p.codigo == codigoProducto);
            if (!producto) throw "No se encontró el producto '" + codigoProducto + "'";
            let time = moment.tz(tiempo, "UTC");
            let tiempoNormalizado = this.normalizaTiempoProducto(time, producto);
            let metadata = await this.findMetadata(tiempoNormalizado, producto, codigoCapa);
            if (!metadata) throw "No hay datos";
            let varMetadata = metadata.variables[codigoCapa];
            let ret = {
                minGlobal:varMetadata.min,
                maxGlobal:varMetadata.max,
                atributos:{
                    "Ejecución Modelo":varMetadata.modelo
                },
                errores:[], advertencias:[], mensajes:[]
            }
            if (varMetadata.noDataValue) ret.noDataValue = varMetadata.noDataValue;
            let outFileName = "tmp_" + parseInt(Math.random() * 9999999999) + ".tif";
            let outPath = config.publishPath + "/" + outFileName;
            let dt = moment.tz(metadata.tiempo, "UTC");
            let srcPath = this.getPathProducto(dt, producto) + ".nc";

            let bbox = this.normalizaBBox(lng0, lat0, lng1, lat1);
            if (bbox.lng0 == bbox.lng1 || bbox.lat0 == bbox.lat1) throw "Área sin Datos";
            maxWidth = maxWidth || 250;
            maxHeight = maxHeight || 250;
            let res = 0.05, width = undefined, height = undefined;            
            if ((bbox.lng1 - bbox.lng0) / res > maxWidth) {
                width = maxWidth;
                height = (bbox.lat1 - bbox.lat0) / res;
            }
            if ((bbox.lat1 - bbox.lat0) / res > maxHeight) {
                height = maxHeight;
                width = width || (bbox.lng1 - bbox.lng0) / res;
            }
            if (width || height) ret.advertencias.push(`Se han interpolado los datos para restringir los resultados a una matriz de ${width} x ${height} puntos. Para usar los datos originales, consulte por un área más pequeña`);            

            await gdal.translateWindow(bbox.lng0, bbox.lat0, bbox.lng1, bbox.lat1, srcPath, outPath, codigoCapa, (width || height)?{width:width, height:height}:null, "nearest");
            if (this.transformers[codigoCapa]) {
                switch(this.transformers[codigoCapa]) {
                    case "K=>C":
                        let outFileName2 = "tmp_" + parseInt(Math.random() * 9999999999) + ".tif";
                        await gdal.calc([{codigo:"A", path:outPath}], config.publishPath + "/" + outFileName2, "A - 273.15");
                        await gdal.stats(config.publishPath + "/" + outFileName2);
                        outFileName = outFileName2;
                        outPath = config.publishPath + "/" + outFileName;
                        break;
                    default:
                        throw "Trandformador '" + this.transformers[codigoCapa] + "' no implementado";
                }
            }

            ret.bbox = bbox;         
            Object.keys(varMetadata.atributos).forEach(attName => {
                ret.atributos[attName] = varMetadata.atributos[attName];
            });
            let info = await gdal.info(outPath, true);
            let banda = info.bands[0];
            //ret.atributos["Nivel"] = banda.description;
            ret.atributos.Tiempo = metadata.tiempo;
            ret.atributos["Tiempo Consultado"] = tiempo;            
            ret.min = banda.computedMin;
            ret.max = banda.computedMax;
            ret.tmpFileName = outFileName;
            ret.resX = info.size[0];
            ret.resY = info.size[1];
            return ret;
        } catch(error) {
            console.error(error);
            throw error;
        }
    }

    async getPreconsultaVector(codigoCapa, lng0, lat0, lng1, lat1, tiempo, nivel, maxWidth, maxHeight) {
        try {
            let vector = this.getVector(codigoCapa);
            let pU = this.getPreconsulta(vector.vector.capaU, lng0, lat0, lng1, lat1, tiempo, nivel, maxWidth, maxHeight);
            let pV = this.getPreconsulta(vector.vector.capaV, lng0, lat0, lng1, lat1, tiempo, nivel, maxWidth, maxHeight);
            let [retU, retV] = await Promise.all([pU, pV]);
            let outFileName = "tmp_" + parseInt(Math.random() * 9999999999) + ".tif";
            let outPath = config.publishPath + "/" + outFileName;
            let fileA = config.publishPath + "/" + retU.tmpFileName;
            let fileB = config.publishPath + "/" + retV.tmpFileName;
            await gdal.calc([{codigo:"A", path:fileA}, {codigo:"B", path:fileB}], outPath, "sqrt(A**2 + B**2)");
            let ret = retU;
            let info = await gdal.info(outPath, true);
            let banda = info.bands[0];
            ret.min = banda.computedMin;
            ret.max = banda.computedMax;
            ret.tmpFileName = outFileName;
            ret.resX = info.size[0];
            ret.resY = info.size[1];

            return ret;
        } catch(error) {
            console.error(error);
            throw error;
        }
    }

    async resuelveConsulta(formato, args) {
        try {
            if (formato == "isolineas") {
                return await this.generaIsolineas(args);
            } else if (formato == "isobandas") {
                return await this.generaIsobandas(args);
            } else if (formato == "serieTiempo") {
                return await this.generaSerieTiempo(args);
            } else if (formato == "valorEnPunto") {
                return await this.generaValorEnPunto(args);
            } else if (formato == "uv") {
                return await this.generaMatrizUV(args);
            } else if (formato == "matrizRectangular") {
                return await this.generaMatrizRectangular(args, "bilinear");
            } else throw "Formato " + formato + " no soportado";
        } catch(error) {
            throw error;
        }
    }

    generaIsolineas(args) {
        try {
            let srcFile = config.publishPath + "/" + args.tmpFileName;
            let dstFile = srcFile + ".isocurvas.shp";
            let increment = args.incremento;
            return new Promise((resolve, reject) => {
                gdal.isolineas(srcFile, dstFile, increment)
                    .then(_ => {
                        resolve({fileName:args.tmpFileName + ".isocurvas.shp"});
                    })
                    .catch(err => reject(err));
            });
        } catch(error) {
            throw error;
        }
    }
    generaMarcadores(isolineas) {
        try {
            let ret = [];
            isolineas.features.forEach(f => {
                if (f.geometry.type == "LineString") {
                    let v = Math.round(f.properties.value * 100) / 100;
                    let n = f.geometry.coordinates.length;
                    let med = parseInt((n - 0.1) / 2);
                    let p0 = f.geometry.coordinates[med], p1 = f.geometry.coordinates[med+1];
                    let lng = (p0[0] + p1[0]) / 2;
                    let lat = (p0[1] + p1[1]) / 2;
                    ret.push({lat:lat, lng:lng, value:v});
                }
            });
            return ret;
        } catch(error) {
            console.error(error);
            return [];
        }
    }

    generaIsobandas(args) {
        try {
            let srcFile = config.publishPath + "/" + args.tmpFileName;
            let dstFile = srcFile + ".isobandas.shp";
            let increment = args.incremento;
            return new Promise((resolve, reject) => {
                gdal.isobandas(srcFile, dstFile, increment)
                    .then(_ => {
                        resolve({fileName:args.tmpFileName + ".isobandas.shp"});
                    })
                    .catch(err => reject(err));
            });
        } catch(error) {
            throw error;
        }
    }

    async generaSerieTiempo(args) {
        try {
            if (this.esVector(args.codigoVariable)) return await this.generaSerieTiempoVector(args);
            let capa = this.getCapa(args.codigoVariable);
            if (!capa) throw "No se encontró la variable '" + args.codigoVariable + "'";
            let levelIndex = 0;
            if (args.levelIndex) levelIndex = args.levelIndex;
            let codigoProducto = capa.opciones.codigoProducto;
            let producto = config.productos.find(p => p.codigo == codigoProducto);
            if (!producto) throw "No se encontró el producto '" + codigoProducto + "'";
            let variableEnProducto = producto.variables.find(v => v.codigo == args.codigoVariable);
            if (!variableEnProducto) throw "No se encontró la variable '" + args.codigoVariable + "' en el producto '" + codigoProducto + "'";

            let lat = args.lat;
            let lng = args.lng;
            let advertencias = [];
            let t0 = args.time0;
            let t1 = args.time1;
            let ajusto = false;
            if ((t1 - t0) > 1000 * 60 * 60 * 24 * 20) {
                t1 = t0 + 1000 * 60 * 60 * 24 * 20;
                advertencias.push("El período de consulta es muy amplio. Se ha ajustado a 20 días desde el inicio consultado")
                ajusto = true;
            }
            let time0 = this.normalizaTiempoProducto(moment.tz(t0, "UTC"), producto);
            let time1 = this.normalizaTiempoProducto(moment.tz(t1, "UTC"), producto);

            let unit, increment;
            switch(producto.temporalidad) {
                case "dia-anterior":
                case "dia-anterior-12":
                    unit = "days", increment = 1;
                    break;
                default: throw "Temporalidad '" + producto.temporalidad + "' no manejada";
            }

            let puntosPendientes = [];
            let time = time0.clone();
            while (!time.isAfter(time1)) {
                let metadata = await this.getMetadata(time, producto);
                if (metadata) {
                    let varMetadata = metadata.variables[args.codigoVariable];
                    if (varMetadata) {
                        let path = this.getPathProducto(time, producto) + ".nc";
                        varMetadata["Tiempo"] = time.valueOf();
                        puntosPendientes.push({time:time.valueOf(), lng:lng, lat:lat, path:path, subDataset:args.codigoVariable, tmpPath:config.dataPath + "/tmp", metadata:varMetadata})
                    }
                }
                time = time.add(increment, unit);
            }
            let ret = {
                lat:lat, lng:lng,
                time0:time0.valueOf(), time1:time1.valueOf(), levelIndex:levelIndex,
                advertencias:advertencias
            }  
            if (!puntosPendientes.length) {
                ret.data = [];
                ret.unit = variableEnProducto.unidad;
                return ret;
            }  
            ret.unit = variableEnProducto.unidad;
            let puntos = await this.getPuntosTimeSerieEnParalelo(puntosPendientes, 10);
            ret.data = puntos;
            return ret;
        } catch(error) {
            throw error;
        }
    }

    async generaSerieTiempoVector(args) {
        try {
            let vector = this.getVector(args.codigoVariable);
            let argsU = JSON.parse(JSON.stringify(args));
            argsU.codigoVariable = vector.vector.capaU;
            let pU = this.generaSerieTiempo(argsU);
            let argsV = JSON.parse(JSON.stringify(args));
            argsV.codigoVariable = vector.vector.capaV;
            let pV = this.generaSerieTiempo(argsV);
            let [retU, retV] = await Promise.all([pU, pV]);
            let ret = retU;
            ret.data.forEach((p, i) => {
                let pU = p.value, pV = retV.data[i].value;
                if (pU !== undefined && pU !== null && pV !== undefined && pV !== null) {
                    ret.data[i] = {time:p.time, value:Math.sqrt(pU * pU + pV * pV)};
                } else {
                    ret.data[i] = {time:p.time, value:null};
                }
            });
            return ret;
        } catch(error) {
            throw error;
        }
    }

    getPuntosTimeSerieEnParalelo(puntosPendientes, nHebras) {
        return new Promise((resolve, reject) => {
            let control = {nPendientesTermino:puntosPendientes.length, resolve:resolve, reject:reject};
            let puntos = [];
            let i=0; 
            while (i<nHebras && puntosPendientes.length) {
                this.iniciaExtraccionSiguientePuntoSerieTiempo(puntosPendientes, puntos, control);
                i++;
            }
        });
    }
    iniciaExtraccionSiguientePuntoSerieTiempo(puntosPendientes, puntosAgregados, control) {
        if (puntosPendientes.length) {
            let args = puntosPendientes[0];
            puntosPendientes.splice(0,1);
            //gdal.getPointValue(args.lng, args.lat, args.path, args.subDataset, args.tmpPath)
            gdal.getPixelValue(args.lng, args.lat, args.path, args.subDataset, args.metadata)
                .then(punto => {
                    if (punto.value !== undefined) {
                        punto.value = this.aplicaTransformacion(args.subDataset, punto.value);
                        let atributos = {
                            "Ejecución Modelo":args.metadata.modelo,
                            "Tiempo":args.metadata.Tiempo
                        }
                        atributos.realLat = punto.realLat;
                        atributos.realLng = punto.realLng;
                        puntosAgregados.push({time:args.time, value:punto.value, atributos:atributos});
                    }
                    control.nPendientesTermino--;
                    this.iniciaExtraccionSiguientePuntoSerieTiempo(puntosPendientes, puntosAgregados, control);
                })
                .catch(error => {
                    control.nPendientesTermino--;
                    this.iniciaExtraccionSiguientePuntoSerieTiempo(puntosPendientes, puntosAgregados, control);
                });            
        } else {
            if (!control.nPendientesTermino) {
                puntosAgregados.sort((p0, p1) => (p0.time - p1.time));
                control.resolve(puntosAgregados);
            }
        }
    }
    
    async generaValorEnPunto(args) {
        try {
            if (this.esVector(args.codigoVariable)) return await this.generaValorEnPuntoVector(args);
            let capa = this.getCapa(args.codigoVariable);
            if (!capa) throw "No se encontró la variable '" + args.codigoVariable + "'";
            let levelIndex = 0;
            if (args.levelIndex) levelIndex = args.levelIndex;
            let codigoProducto = capa.opciones.codigoProducto;
            let producto = config.productos.find(p => p.codigo == codigoProducto);
            if (!producto) throw "No se encontró el producto '" + codigoProducto + "'";
            let variableEnProducto = producto.variables.find(v => v.codigo == args.codigoVariable);
            if (!variableEnProducto) throw "No se encontró la variable '" + args.codigoVariable + "' en el producto '" + codigoProducto + "'";

            let lat = args.lat;
            let lng = args.lng;
            let time = this.normalizaTiempoProducto(moment.tz(args.time, "UTC"), producto);
            let metadata = await this.findMetadata(time, producto, args.codigoVariable);
            if (!metadata) return "S/D";
            let varMetadata = metadata.variables[args.codigoVariable];
            if (varMetadata) {
                time = moment.tz(metadata.tiempo, "UTC");
                let atributos = {
                    Tiempo:metadata.tiempo,
                    "Ejecución Modelo":varMetadata.modelo
                }
                Object.keys(varMetadata.atributos).forEach(key => {
                    atributos[key] = varMetadata.atributos[key];
                });
                let path = this.getPathProducto(time, producto) + ".nc";
                let punto = await gdal.getPixelValue(lng, lat, path, args.codigoVariable, varMetadata);
                if (!punto) return "S/D";
                atributos.realLng = punto.realLng;
                atributos.realLat = punto.realLat;
                return {lng:lng, lat:lat, time:time, metadata:varMetadata, value:punto.value, atributos:atributos}
            }
            return "S/D";
        } catch(error) {
            console.error(error);
            throw error;
        }
    }

    async generaValorEnPuntoVector(args) {        
        try {
            let vector = this.getVector(args.codigoVariable);
            let argsU = JSON.parse(JSON.stringify(args));
            argsU.codigoVariable = vector.vector.capaU;
            let pU = this.generaValorEnPunto(argsU);
            let argsV = JSON.parse(JSON.stringify(args));
            argsV.codigoVariable = vector.vector.capaV;
            let pV = this.generaValorEnPunto(argsV);
            let [retU, retV] = await Promise.all([pU, pV]);
            let ret = retU;
            if (retU.value !== undefined && retU.value !== null && retV.value !== undefined && retV.value !== null) {
                ret.value = Math.sqrt(retU.value * retU.value + retV.value * retV.value);
            } else {
                ret.value = null;
            }
            return ret;
        } catch(error) {
            console.error(error);
            throw error;
        }
    }

    async generaMatrizUV(args) {
        try {
            let vector = this.getVector(args.codigoVariable);
            if (!vector) throw "No se encontró el vector '" + args.codigoVariable + "'";
            let argsU = JSON.parse(JSON.stringify(args));
            argsU.codigoVariable = vector.vector.capaU;
            let pU = this.generaMatrizRectangular(argsU);
            let argsV = JSON.parse(JSON.stringify(args));
            argsV.codigoVariable = vector.vector.capaV;
            let pV = this.generaMatrizRectangular(argsV);
            let [matrizU, matrizV] = await Promise.all([pU, pV]);
            let data = [];
            matrizU.rows.forEach((row, iRow) => {
                row.forEach((vU, iCol) => {
                    let vV = matrizV.rows[iRow][iCol];
                    if (vU !== undefined && vU !== null && vV !== undefined && vV !== null) {
                        data.push(vU, vV);
                    } else {
                        data.push(null, null);
                    }
                });
            });
            let ret = {
                time:matrizU.time,
                lng0:matrizU.lng0, lat0:matrizU.lat0, lng1:matrizU.lng1, lat1:matrizU.lat1,
                deltaLng:matrizU.dx,
                deltaLat:matrizU.dy,
                nrows:matrizU.nrows,
                ncols:matrizU.ncols,
                mensajes:matrizU.mensajes?matrizU.mensajes:[], advertencias:matrizU.advertencias, errores:matrizU.errores,
                resolution:args.resolution,
                metadataU:matrizU.metadata,
                metadataV:matrizV.metadata,
                atributos:matrizU.atributos,
                data:data
            }
            return ret;
        } catch(error) {
            console.error(error);
            throw error;
        }
    }

    async generaMatrizRectangular(args, interpolacion) {
        try { 
            if (this.esVector(args.codigoVariable)) return await this.generaMatrizRectangularVector(args, interpolacion);
            let capa = this.getCapa(args.codigoVariable);
            if (!capa) throw "No se encontró la variable '" + args.codigoVariable + "'";
            if (args.levelIndex) levelIndex = args.levelIndex;
            let codigoProducto = capa.opciones.codigoProducto;
            let producto = config.productos.find(p => p.codigo == codigoProducto);
            if (!producto) throw "No se encontró el producto '" + codigoProducto + "'";
            let variableEnProducto = producto.variables.find(v => v.codigo == args.codigoVariable);
            if (!variableEnProducto) throw "No se encontró la variable '" + args.codigoVariable + "' en el producto '" + codigoProducto + "'";

            let b = this.normalizaBBox(args.lng0, args.lat0, args.lng1, args.lat1);
            let time = this.normalizaTiempoProducto(moment.tz(args.time, "UTC"), producto);
            let metadata = await this.findMetadata(time, producto, args.codigoVariable);
            if (!metadata) throw "Sin Datos";
            time = moment.tz(metadata.tiempo, "UTC");
            let varMetadata = metadata?metadata.variables[args.codigoVariable]:null;
            if (!varMetadata) throw "No hay Datos";

            let maxWidth = args.resolution || args.maxWidth || 250;
            let maxHeight = args.resolution || args.maxHeight || 250;

            let path = this.getPathProducto(time, producto) + ".nc";
            let {data, box} = await gdal.getRectangularMatrix(b.lng0, b.lat0, b.lng1, b.lat1, path, args.codigoVariable, maxWidth, maxHeight, config.publishPath, interpolacion, varMetadata);
            data.metadata = varMetadata;
            data.time = time.valueOf();
            data.unit = varMetadata.unidad;;
            if (varMetadata.noDataValue || this.transformers[args.codigoVariable]) {
                let min = undefined, max = undefined; // corregir min / max
                data.rows.forEach(row => {
                    row.forEach((v, i) => {
                        if (v == varMetadata.noDataValue) {
                            row[i] = null;
                        } else {
                            v = this.aplicaTransformacion(args.codigoVariable, v);
                            row[i] = v;
                            if (min === undefined || v < min) min = v;
                            if (max === undefined || v > max) max = v;
                        }
                    });
                })
                data.min = min;
                data.max = max;
            }
            //if (width == maxWidth || height == maxHeight) data.advertencias = ["Se han interpolado los resultados para ajustarse a una resolución de " + width + "[lng] x " + height + "[lat]. Para obtener los datos originales, consulte por un área más pequeña."];
            data.advertencias = [];
            if (box.width != box.outWidth) data.advertencias.push("Se ha ajustado el ancho desde " + box.width + " a " + box.outWidth + ". Disminuya el área de consulta para ver todos los datos originales");
            if (box.height != box.outHeight) data.advertencias.push("Se ha ajustado el alto desde " + box.height + " a " + box.outHeight + ". Disminuya el área de consulta para ver todos los datos originales");
            return data;
        } catch(error) {
            console.error(error);
            throw error;
        }
    }

    async generaMatrizRectangularVector(args, interpolacion) {
        try { 
            let vector = this.getVector(args.codigoVariable);
            let argsU = JSON.parse(JSON.stringify(args));
            argsU.codigoVariable = vector.vector.capaU;
            let pU = this.generaMatrizRectangular(argsU, interpolacion);
            let argsV = JSON.parse(JSON.stringify(args));
            argsV.codigoVariable = vector.vector.capaV;
            let pV = this.generaMatrizRectangular(argsV, interpolacion);
            let [retU, retV] = await Promise.all([pU, pV]);
            let data = retU;
            let min = undefined, max = undefined; // corregir min / max
            data.rows.forEach((row, iRow) => {
                row.forEach((vU, iCol) => {
                    let vV = retV.rows[iRow][iCol];
                    if (vU !== undefined && vU !== null && vV !== undefined && vV !== null) {
                        let v = Math.sqrt(vU * vU + vV * vV);
                        row[iCol] = v;
                        if (min === undefined || v < min) min = v;
                        if (max === undefined || v > max) max = v;
                    } else {
                        row[iCol] = null;
                    }
                });
            })
            data.min = min;
            data.max = max;
            return data;
        } catch(error) {
            console.error(error);
            throw error;
        }
    }
}

module.exports = ProveedorCapasCopernicus;