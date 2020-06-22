const { exec } = require('child_process');
const fs = require("fs");

class GDAL {
    static get instance() {
        if (GDAL.singleton) return GDAL.singleton;
        GDAL.singleton = new GDAL();
        return GDAL.singleton;
    }

    boxToPixels(lng0, lat0, lng1, lat1, varMetadata, maxWidth, maxHeight) {
        let fileLat0 = varMetadata.lat0;
        let fileLat1 = varMetadata.lat1;
        let fileLng0 = varMetadata.lng0;
        let fileLng1 = varMetadata.lng1;
        let fileWidth = varMetadata.width;
        let fileHeight = varMetadata.height;
        let dx = (fileLng1 - fileLng0) / fileWidth;
        let dy = (fileLat1 - fileLat0) / fileHeight;
        let x0 = parseInt((lng0 - fileLng0) / dx);
        let y0 = parseInt((lat0 - fileLat0) / dy);
        let x1 = parseInt((lng1 - fileLng0) / dx) + 1;
        let y1 = parseInt((lat1 - fileLat0) / dy) + 1;
        x0 = x0 < 0?0:x0; x0 = x0 >= fileWidth?fileWidth - 1:x0;
        y0 = y0 < 0?0:y0; y0 = y0 >= fileHeight?fileHeight - 1:y0;
        x1 = x1 < 0?0:x1; x1 = x1 >= fileWidth?fileWidth - 1:x1;
        y1 = y1 < 0?0:y1; y1 = y1 >= fileHeight?fileHeight - 1:y1;
        let width = x1 - x0, height = y1 - y0;
        let outWidth = width, outHeight = height, outDx = dx, outDy = dy;
        while (maxWidth && outWidth > maxWidth) {
            outWidth /= 2;
            outDx *= 2;
        }
        while (maxHeight && outHeight > maxHeight) {
            outHeight /= 2;
            outDy *= 2;
        }
        y0 = fileHeight - y0;
        y1 = fileHeight - y1;        
        return {x0, y0, x1, y1, width, height, outDx, outDy, outWidth, outHeight}
    }

    info(path, includeMM, sd) {
        return new Promise((resolve, reject) => {
            let cmd = "gdalinfo" + " " + path;
            if (sd !== undefined) cmd += " -sd " + sd;
            cmd += " -json" + (includeMM?" -mm":"");
            exec(cmd, {maxBuffer:1024 * 1024}, (err, stdout, stderr) => {
                if (err) reject(err);
                else {
                    if (stderr) reject(stderr);
                    else resolve(JSON.parse(stdout));
                }
            });
        });
    }
    coordenadasProjection(lng0, lat0, lng1, lat1) {
        let west = lng0;
        if (west < 0) west += 360;
        let east = lng1;
        if (east < 0) east += 360;
        
        let south = lat0;
        let north = lat1;
        return {w:west, n:north, e:east, s:south}
    }
    translateWindow(lng0, lat0, lng1, lat1, srcFile, dstFile, subDataset, outsize, interpolacion) {
        return new Promise((resolve, reject) => {
            let cmd = "gdal_translate -q -projwin " + lng0 + " " + lat1 + " " + lng1 + " " + lat0;
            if (outsize) {
                cmd += " -outsize " + (outsize.width) + " " + (outsize.height);
            }
            if (interpolacion) {
                cmd += " -r " + interpolacion;
            }
            cmd += " -unscale";
            cmd += " -ot Float64";
            cmd += " NETCDF:\"" + srcFile + "\":" + subDataset + " " + dstFile;
            exec(cmd, {maxBuffer:1024 * 10}, (err, stdout, stderr) => {
                if (err) reject(err);
                else {
                    if (stderr) {
                        // reject(stderr);
                        console.log("GDAL Translate para " + dstFile + ". Se recibe error o advertencia:" + stderr + " ... se ignora");
                    }
                    resolve();
                }
            });
        });        
    }

    isolineas(srcFile, outFile, increment) {
        return new Promise((resolve, reject) => {
            let cmd = "gdal_contour -a value -i " + increment + " " + srcFile + " " + outFile;
            exec(cmd, {maxBuffer:1024 * 10}, (err, stdout, stderr) => {
                if (err) reject(err);
                else {
                    if (stderr) reject(stderr);
                    else resolve();
                }
            });
        });
    }

    isobandas(srcFile, outFile, increment) {
        return new Promise((resolve, reject) => {
            let cmd = "gdal_contour -amin minValue -amax maxValue -p -i " + increment + " " + srcFile + " " + outFile;
            exec(cmd, {maxBuffer:1024 * 10}, (err, stdout, stderr) => {
                if (err) reject(err);
                else {
                    if (stderr) reject(stderr);
                    else resolve();
                }
            });
        });
    }
    
    calc(variables, outFile, formula) {
        return new Promise((resolve, reject) => {
            let cmd = "gdal_calc.py";
            variables.forEach(v => cmd += " -" + v.codigo + " " + v.path);
            cmd += " --outfile=" + outFile + " --calc=\"" + formula + "\" --quiet";
            exec(cmd, {maxBuffer:1024 * 10}, (err, stdout, stderr) => {
                if (err) reject(err);
                else {
                    if (stderr) reject(stderr);
                    else resolve();
                }
            });
        });
    }

    stats(path) {
        return new Promise((resolve, reject) => {
            let cmd = "gdal_edit.py";            
            cmd += " -stats " + path;
            exec(cmd, {maxBuffer:1024 * 10}, (err, stdout, stderr) => {
                if (err) reject(err);
                else {
                    if (stderr) reject(stderr);
                    else resolve();
                }
            });
        });
    }


    getRectangularMatrix(lng0, lat0, lng1, lat1, file, subDataset, maxWidth, maxHeight, tmpPath, interpolacion, varMetadata) {        
        return new Promise((resolve, reject) => {
            let box = this.boxToPixels(lng0, lat0, lng1, lat1, varMetadata, maxWidth, maxHeight);
            let tmpFileName = tmpPath + "/tmp_" + parseInt(1000000 * Math.random());
            let cmd = "gdal_translate -q -srcwin " + box.x0 + " " + box.y1 + " " + box.width + " " + box.height;
            cmd += " -tr " + box.outDx + " " + box.outDy;
            cmd += " -of AAIGrid";
            if (interpolacion) {
                cmd += " -r " + interpolacion;
            }
            cmd += " -unscale";
            cmd += " -ot Float64";
            cmd += " NETCDF:\"" + file + "\":" + subDataset + " " + tmpFileName + ".tmp";
            exec(cmd, {maxBuffer:1024 * 1024 * 10}, (err, stdout, stderr) => {
                if (err) {
                    reject(err);
                    return;
                }
                fs.readFile(tmpFileName + ".tmp", (err, data) => {
                    let lines = data.toString().split("\n");
                    try {
                        let data = this.parseLines(lines);
                        data.lng0 = data.xllcorner;
                        data.lng1 = data.lng0 + box.outDx * data.ncols;
                        data.lat0 = data.yllcorner;
                        data.lat1 = data.lat0 + box.outDy * data.nrows;
                        data.dx = box.outDx;
                        data.dy = box.outDy;
                        resolve({data, box});
                    } catch(error) {
                        reject(error);
                    } finally {
                        fs.unlink(tmpFileName + ".prj", _ => {});
                        fs.unlink(tmpFileName + ".tmp", _ => {});
                        fs.unlink(tmpFileName + ".tmp.aux.xml", _ => {});
                    }
                });
            });
        });        
    }

    parseLines(lines) {
        let ret = {rows:[], min:undefined, max:undefined};
        lines.forEach(l => {
            if (l.trim().length > 0) {
                let fields = l.trim().split(" ").filter(v => v.trim().length > 0);
                if (fields.length) {
                    let fieldName = fields[0];
                    if (!isNaN(parseFloat(fieldName))) {
                        let row = [];
                        ret.rows.push(row);
                        // row or single value
                        fields.forEach(field => {
                            let value = parseFloat(field);                            
                            if (isNaN(value)) throw "Formato de linea inválido\n" + l;
                            ret.value = value;
                            row.push(value);
                            if (ret.min === undefined || value < ret.min) ret.min = value;
                            if (ret.max === undefined || value > ret.max) ret.max = value;
                        });
                    } else {
                        // field = value
                        if (fields.length != 2) throw "Formato inválido para linea\n" + l + ".\n Se esperaba campo valor_numerico";
                        let value = parseFloat(fields[1]);
                        if (isNaN(value)) throw "Formato inválido para linea\n" + l + ".\n Se esperaba campo valor_numerico";
                        ret[fieldName] = value;
                    }
                }
            }
        });
        // invertir filas        
        let swap = [];
        for (let i=ret.rows.length - 1; i>=0; i--) swap.push(ret.rows[i]);
        ret.rows = swap;        
        return ret;
    }
    getPixelValue(lng, lat, file, subDataset, varMetadata, tmpPath) {
        let fileLat0 = varMetadata.lat0;
        let fileLat1 = varMetadata.lat1;
        let fileLng0 = varMetadata.lng0;
        let fileLng1 = varMetadata.lng1;
        let fileWidth = varMetadata.width;
        let fileHeight = varMetadata.height;
        let dx = (fileLng1 - fileLng0) / fileWidth;
        let dy = (fileLat1 - fileLat0) / fileHeight;
        let x = (lng - fileLng0) / dx;
        if (x - parseInt(x) > 0.5) x = parseInt(x) + 1;
        else x = parseInt(x);
        let y = (lat - fileLat0) / dy;
        if (y - parseInt(y) > 0.5) y = parseInt(y) + 1;
        else y = parseInt(y);
        y = varMetadata.height - y - 1;        
        return new Promise((resolve, reject) => {
            let tmpFileName = tmpPath + "/tmp_" + parseInt(1000000 * Math.random());
            if (x < 0 || x >= fileWidth || y < 0 || y >= fileHeight) {
                reject("S/D");
                return;
            };
            let cmd = "gdal_translate -q -srcwin " + x + " " + y + " 1 1";
            cmd += " -of AAIGrid";
            cmd += " -unscale";
            cmd += " -ot Float64";
            cmd += " NETCDF:\"" + file + "\":" + subDataset + " " + tmpFileName + ".tmp";
            exec(cmd, {maxBuffer:1024 * 1024 * 10}, (err, stdout, stderr) => {
                if (err) {
                    reject(err);
                    return;
                }
                fs.readFile(tmpFileName + ".tmp", (err, data) => {
                    let lines = data.toString().split("\n");
                    try {
                        let data = this.parseLines(lines);
                        console.log("data", data);
                        if (!data.nrows || !data.ncols) {
                            reject("S/D");
                            return;
                        }
                        let ret = {realLng:data.xllcorner, realLat:data.yllcorner, value:data.rows[0][0]};
                        resolve(ret);
                    } catch(error) {
                        reject(error);
                    } finally {
                        fs.unlink(tmpFileName + ".prj", _ => {});
                        fs.unlink(tmpFileName + ".tmp", _ => {});
                        fs.unlink(tmpFileName + ".tmp.aux.xml", _ => {});
                    }
                });
            });
        })
    }
}

module.exports = GDAL.instance;