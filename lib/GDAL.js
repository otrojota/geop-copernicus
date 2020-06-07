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
        let width = x1 - x0 + 1, height = y1 - y0 + 1;
        let outWidth, outHeight, outDx, outDy;
        if (maxWidth && width > maxWidth) {
            let n = width / maxWidth;
            if (n != parseInt(n)) {
                n = parseInt(n + 1);
                if (x0 + maxWidth * n * dx > x1) n--;                
            }
            width = maxWidth * n;
            x1 = x0 + width - 1;
            outWidth = maxWidth
            outDx = n * dx;
        } else {
            outWidth = width;
            outDx = dx;
        }
        if (maxHeight && height > maxHeight) {
            let n = height / maxHeight;
            if (n != parseInt(n)) {
                n = parseInt(n + 1);
                if (y0 + maxHeight * n * dy > y1) n--;                
            }
            height = maxHeight * n;
            y1 = y0 + height - 1;
            outHeight = maxHeight
            outDy = n * dy;
        } else {
            outHeight = height;
            outDy = dy;
        }
        let newLng0 = fileLng0 + x0*dx;
        let newLat0 = fileLat0 + y0*dy;
        let newLng1 = fileLng0 + x1*dx;
        let newLat1 = fileLat0 + y1*dy;
        y0 = fileHeight - y0;
        y1 = fileHeight - y1;        
        return {x0, y0, x1, y1, width, height,  newLng0, newLat0, newLng1, newLat1, outWidth, outHeight, outDx, outDy}
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
            cmd += " -outsize " + box.outWidth + " " + box.outHeight;
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
                        data.lng1 = data.lng0 + box.outDx * (data.ncols - 1);
                        data.lat0 = data.yllcorner;
                        data.lat1 = data.lat0 + box.outDy * (data.nrows - 1);
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
    getPointValue(lng, lat, file, subDataset, tmpPath) {
        return new Promise((resolve, reject) => {
            let tmpFileName = tmpPath + "/tmp_" + parseInt(1000000 * Math.random());
            let cmd = "gdal_translate -q -projwin " + (lng - 0.1) + " " + (lat + 0.1) + " " + (lng + 0.1) + " " + (lat - 0.1);
            cmd += " -outsize " + 1 + " " + 1;
            cmd += " -of AAIGrid";
            //cmd += " -r bilinear";
            cmd += " -r mode";
            cmd += " -unscale -ot Float64";
            cmd += " NETCDF:\"" + file + "\":" + subDataset + " " + tmpFileName + ".tmp";
            exec(cmd, {maxBuffer:1024 * 1024 * 10}, (err, stdout, stderr) => {
                if (err) {
                    reject(err);
                    return;
                }
                fs.readFile(tmpFileName + ".tmp", (err, data) => {
                    let lines = data.toString().split("\n");
                    let fields = this.parseLines(lines);                   
                    fs.unlink(tmpFileName + ".prj", _ => {});
                    fs.unlink(tmpFileName + ".tmp", _ => {});
                    fs.unlink(tmpFileName + ".tmp.aux.xml", _ => {});
                    if (fields.value === undefined || fields.value == fields.NODATA_value) reject("Sin Datos");
                    else resolve(fields.value);
                });
            });
        });        
    }
    getPixelValue(lng, lat, file, subDataset, varMetadata) {
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
        let realLng = fileLng0 + x*dx;
        let realLat = fileLat0 + y*dy;
        y = varMetadata.height - y;
        let ret = {realLng:realLng, realLat:realLat};
        return new Promise((resolve, reject) => {
            if (x < 0 || x >= fileWidth || y < 0 || y >= fileHeight) {
                resolve(ret);
                return;
            };
            let cmd = "gdallocationinfo ";
            cmd += " NETCDF:\"" + file + "\":" + subDataset;
            cmd += " -valonly";
            cmd += " " + x + " " + y;
            exec(cmd, {maxBuffer:1024 * 1024 * 10}, (err, stdout, stderr) => {
                if (err) {
                    reject(err);
                    return;
                }
                let v = parseFloat(stdout);
                if (varMetadata.noDataValue && v == varMetadata.noDataValue) v = undefined;
                if (!isNaN(v)) ret.value = v;
                resolve(ret);
            });
        })
    }
}

module.exports = GDAL.instance;