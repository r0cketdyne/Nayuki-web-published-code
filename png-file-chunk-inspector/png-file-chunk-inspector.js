/*
 * PNG file chunk inspector (compiled from TypeScript)
 *
 * Copyright (c) 2021 Project Nayuki
 * All rights reserved. Contact Nayuki for licensing.
 * https://www.nayuki.io/page/png-file-chunk-inspector
 */
"use strict";
var __extends = (this && this.__extends) || (function () {
    var extendStatics = function (d, b) {
        extendStatics = Object.setPrototypeOf ||
            ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
            function (d, b) { for (var p in b) if (Object.prototype.hasOwnProperty.call(b, p)) d[p] = b[p]; };
        return extendStatics(d, b);
    };
    return function (d, b) {
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    };
})();
var app;
(function (app) {
    /*---- Graphical user interface ----*/
    function initialize() {
        var fileElem = requireType(document.querySelector("article input[type=file]"), HTMLInputElement);
        fileElem.onchange = function () {
            var files = fileElem.files;
            if (files === null || files.length < 1)
                return;
            var reader = new FileReader();
            reader.onload = function () {
                var bytes = requireType(reader.result, ArrayBuffer);
                visualizeFile(new Uint8Array(bytes));
            };
            reader.readAsArrayBuffer(files[0]);
        };
    }
    setTimeout(initialize);
    function visualizeFile(fileBytes) {
        var table = requireType(document.querySelector("article table"), HTMLElement);
        table.classList.remove("errors");
        var tbody = requireType(table.querySelector("tbody"), HTMLElement);
        while (tbody.firstChild !== null)
            tbody.removeChild(tbody.firstChild);
        var parts = parseFile(fileBytes);
        var summary = "";
        for (var i = 0; i < parts.length; i++) {
            var part = parts[i];
            if (part instanceof ChunkPart) {
                if (summary != "")
                    summary += ", ";
                summary += part.typeStr;
                if (part.typeStr == "IDAT") {
                    var count = 1;
                    for (; i + 1 < parts.length; i++, count++) {
                        var nextPart = parts[i + 1];
                        if (!(nextPart instanceof ChunkPart) || nextPart.typeStr != "IDAT")
                            break;
                    }
                    if (count > 1)
                        summary += " \u00D7" + count;
                }
            }
        }
        requireType(document.querySelector("article span#summary"), HTMLElement).textContent = summary;
        var _loop_1 = function (part) {
            var tr = appendElem(tbody, "tr");
            appendElem(tr, "td", uintToStrWithThousandsSeparators(part.offset));
            {
                var td = appendElem(tr, "td");
                var hex_1 = [];
                var bytes_1 = part.bytes;
                var pushHex = function (index) {
                    hex_1.push(bytes_1[index].toString(16).padStart(2, "0"));
                };
                if (bytes_1.length <= 100) {
                    for (var i = 0; i < bytes_1.length; i++)
                        pushHex(i);
                }
                else {
                    for (var i = 0; i < 70; i++)
                        pushHex(i);
                    hex_1.push("...");
                    for (var i = bytes_1.length - 30; i < bytes_1.length; i++)
                        pushHex(i);
                }
                appendElem(td, "code", hex_1.join(" "));
            }
            for (var _i = 0, _a = [part.outerNotes, part.innerNotes, part.errorNotes]; _i < _a.length; _i++) {
                var list = _a[_i];
                var td = appendElem(tr, "td");
                var ul = appendElem(td, "ul");
                for (var _b = 0, list_1 = list; _b < list_1.length; _b++) {
                    var item = list_1[_b];
                    if (list == part.errorNotes)
                        table.classList.add("errors");
                    var li = appendElem(ul, "li");
                    if (typeof item == "string")
                        li.textContent = item;
                    else if (item instanceof Node)
                        li.appendChild(item);
                    else
                        throw "Assertion error";
                }
            }
        };
        for (var _i = 0, parts_1 = parts; _i < parts_1.length; _i++) {
            var part = parts_1[_i];
            _loop_1(part);
        }
    }
    /*---- PNG file parser ----*/
    function parseFile(fileBytes) {
        var result = [];
        var isSignatureValid;
        var offset = 0;
        { // Parse file signature
            var bytes = fileBytes.subarray(offset, Math.min(offset + SignaturePart.FILE_SIGNATURE.length, fileBytes.length));
            var part = new SignaturePart(offset, bytes);
            result.push(part);
            isSignatureValid = part.errorNotes.length == 0;
            offset += bytes.length;
        }
        if (!isSignatureValid && offset < fileBytes.length) {
            var bytes = fileBytes.subarray(offset, fileBytes.length);
            var part = new UnknownPart(offset, bytes);
            part.errorNotes.push("Unknown format");
            result.push(part);
            offset += bytes.length;
        }
        else if (isSignatureValid) {
            // Parse chunks but carefully handle erroneous file structures
            while (offset < fileBytes.length) {
                // Begin by assuming that the next chunk is invalid
                var bytes = fileBytes.subarray(offset, fileBytes.length);
                var remain = bytes.length;
                if (remain >= 4) {
                    var innerLen = readUint32(fileBytes, offset);
                    var outerLen = innerLen + 12;
                    if (innerLen <= ChunkPart.MAX_DATA_LENGTH && outerLen <= remain)
                        bytes = fileBytes.subarray(offset, offset + outerLen); // Chunk is now valid with respect to length
                }
                result.push(new ChunkPart(offset, bytes));
                offset += bytes.length;
            }
            // Annotate chunks
            var earlierChunks = [];
            var earlierTypes = new Set();
            for (var _i = 0, result_1 = result; _i < result_1.length; _i++) {
                var part_1 = result_1[_i];
                if (!(part_1 instanceof ChunkPart))
                    continue;
                var type = part_1.typeStr;
                if (type != "IHDR" && type != "" && !earlierTypes.has("IHDR"))
                    part_1.errorNotes.push("Chunk must be after IHDR chunk");
                if (type != "IEND" && type != "" && earlierTypes.has("IEND"))
                    part_1.errorNotes.push("Chunk must be before IEND chunk");
                var typeInfo = part_1.getTypeInfo();
                if (typeInfo !== null && !typeInfo[1] && earlierTypes.has(type))
                    part_1.errorNotes.push("Multiple chunks of this type disallowed");
                part_1.annotate(earlierChunks);
                earlierChunks.push(part_1);
                earlierTypes.add(type);
            }
            {
                var ihdrIndex = 0;
                while (ihdrIndex < result.length && (!(result[ihdrIndex] instanceof ChunkPart) || result[ihdrIndex].typeStr != "IHDR"))
                    ihdrIndex++;
                var iendIndex = 0;
                while (iendIndex < result.length && (!(result[iendIndex] instanceof ChunkPart) || result[iendIndex].typeStr != "IEND"))
                    iendIndex++;
                var processedDsigs = new Set();
                if (ihdrIndex < result.length && iendIndex < result.length) {
                    var start = ihdrIndex + 1;
                    var end = iendIndex - 1;
                    for (; start < end; start++, end--) {
                        var startPart = result[start];
                        var endPart = result[end];
                        if (!(startPart instanceof ChunkPart && startPart.typeStr == "dSIG" &&
                            endPart instanceof ChunkPart && endPart.typeStr == "dSIG"))
                            break;
                        startPart.innerNotes.push("Introductory");
                        endPart.innerNotes.push("Terminating");
                        processedDsigs.add(startPart);
                        processedDsigs.add(endPart);
                    }
                    for (; start < end; start++) {
                        var part_2 = result[start];
                        if (!(part_2 instanceof ChunkPart && part_2.typeStr == "dSIG"))
                            break;
                        part_2.innerNotes.push("Introductory");
                        part_2.errorNotes.push("Missing corresponding terminating dSIG chunk");
                    }
                    for (; start < end; end--) {
                        var part_3 = result[start];
                        if (!(part_3 instanceof ChunkPart && part_3.typeStr == "dSIG"))
                            break;
                        part_3.innerNotes.push("Terminating");
                        part_3.errorNotes.push("Missing corresponding introductory dSIG chunk");
                    }
                }
                for (var _a = 0, result_2 = result; _a < result_2.length; _a++) {
                    var part_4 = result_2[_a];
                    if (part_4 instanceof ChunkPart && part_4.typeStr == "dSIG" && !processedDsigs.has(part_4))
                        part_4.errorNotes.push("Chunk must be consecutively after IHDR chunk or consecutively before IEND chunk");
                }
            }
            var part = new UnknownPart(offset, new Uint8Array());
            if (!earlierTypes.has("IHDR"))
                part.errorNotes.push("Missing IHDR chunk");
            if (!earlierTypes.has("IDAT"))
                part.errorNotes.push("Missing IDAT chunk");
            if (!earlierTypes.has("IEND"))
                part.errorNotes.push("Missing IEND chunk");
            if (part.errorNotes.length > 0)
                result.push(part);
        }
        if (offset != fileBytes.length)
            throw "Assertion error";
        return result;
    }
    /*---- Classes representing different file parts ----*/
    var FilePart = /** @class */ (function () {
        function FilePart(offset, bytes) {
            this.offset = offset;
            this.bytes = bytes;
            this.outerNotes = [];
            this.innerNotes = [];
            this.errorNotes = [];
        }
        return FilePart;
    }());
    var SignaturePart = /** @class */ (function (_super) {
        __extends(SignaturePart, _super);
        function SignaturePart(offset, bytes) {
            var _this = _super.call(this, offset, bytes) || this;
            _this.outerNotes.push("Special: File signature");
            _this.outerNotes.push("Length: " + uintToStrWithThousandsSeparators(bytes.length) + " bytes");
            _this.innerNotes.push("\u201C" + bytesToReadableString(bytes) + "\u201D");
            for (var i = 0; i < SignaturePart.FILE_SIGNATURE.length && _this.errorNotes.length == 0; i++) {
                if (i >= bytes.length)
                    _this.errorNotes.push("Premature EOF");
                else if (bytes[i] != SignaturePart.FILE_SIGNATURE[i])
                    _this.errorNotes.push("Value mismatch");
            }
            return _this;
        }
        SignaturePart.FILE_SIGNATURE = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
        return SignaturePart;
    }(FilePart));
    var UnknownPart = /** @class */ (function (_super) {
        __extends(UnknownPart, _super);
        function UnknownPart(offset, bytes) {
            var _this = _super.call(this, offset, bytes) || this;
            _this.outerNotes.push("Special: Unknown");
            _this.outerNotes.push("Length: " + uintToStrWithThousandsSeparators(bytes.length) + " bytes");
            return _this;
        }
        return UnknownPart;
    }(FilePart));
    var ChunkPart = /** @class */ (function (_super) {
        __extends(ChunkPart, _super);
        function ChunkPart(offset, bytes) {
            var _this = _super.call(this, offset, bytes) || this;
            _this.typeStr = "";
            _this.data = new Uint8Array();
            if (bytes.length < 4) {
                _this.outerNotes.push("Data length: Unfinished");
                _this.errorNotes.push("Premature EOF");
                return _this;
            }
            var dataLen = readUint32(bytes, 0);
            _this.outerNotes.push("Data length: " + uintToStrWithThousandsSeparators(dataLen) + " bytes");
            if (dataLen > ChunkPart.MAX_DATA_LENGTH)
                _this.errorNotes.push("Length out of range");
            else if (bytes.length < dataLen + 12)
                _this.errorNotes.push("Premature EOF");
            if (bytes.length < 8) {
                _this.outerNotes.push("Type: Unfinished");
                return _this;
            }
            {
                var typeBytes = bytes.subarray(4, 8);
                _this.typeStr = bytesToReadableString(typeBytes);
                _this.outerNotes.push("Type: " + _this.typeStr);
                var typeInfo = _this.getTypeInfo();
                var typeName = typeInfo !== null ? typeInfo[0] : "Unknown";
                _this.outerNotes.push("Name: " + typeName);
                _this.outerNotes.push((typeBytes[0] & 0x20) == 0 ? "Critical (0)" : "Ancillary (1)");
                _this.outerNotes.push((typeBytes[1] & 0x20) == 0 ? "Public (0)" : "Private (1)");
                _this.outerNotes.push((typeBytes[2] & 0x20) == 0 ? "Reserved (0)" : "Unknown (1)");
                _this.outerNotes.push((typeBytes[3] & 0x20) == 0 ? "Unsafe to copy (0)" : "Safe to copy (1)");
            }
            if (dataLen > ChunkPart.MAX_DATA_LENGTH) {
                _this.typeStr = "";
                return _this;
            }
            if (bytes.length < dataLen + 12) {
                _this.outerNotes.push("CRC-32: Unfinished");
                _this.typeStr = "";
                return _this;
            }
            {
                var storedCrc = readUint32(bytes, bytes.length - 4);
                _this.outerNotes.push("CRC-32: " + storedCrc.toString(16).padStart(8, "0").toUpperCase());
                var dataCrc = calcCrc32(bytes.subarray(4, bytes.length - 4));
                if (dataCrc != storedCrc)
                    _this.errorNotes.push("CRC-32 mismatch (calculated from data: " + dataCrc.toString(16).padStart(8, "0").toUpperCase() + ")");
                _this.data = bytes.subarray(8, bytes.length - 4);
            }
            return _this;
        }
        ChunkPart.prototype.annotate = function (earlierChunks) {
            if (this.innerNotes.length > 0)
                throw "Already annotated";
            var temp = this.getTypeInfo();
            if (temp !== null)
                temp[2](this, earlierChunks);
        };
        ChunkPart.prototype.getTypeInfo = function () {
            var result = null;
            for (var _i = 0, _a = ChunkPart.TYPE_HANDLERS; _i < _a.length; _i++) {
                var _b = _a[_i], type = _b[0], name_1 = _b[1], multiple = _b[2], func = _b[3];
                if (type == this.typeStr) {
                    if (result !== null)
                        throw "Table has duplicate keys";
                    result = [name_1, multiple, func];
                }
            }
            return result;
        };
        // The maximum length of a chunk's payload data, in bytes, inclusive.
        ChunkPart.MAX_DATA_LENGTH = 0x7FFFFFFF;
        /*---- Handlers and metadata for all known PNG chunk types ----*/
        ChunkPart.TYPE_HANDLERS = [
            ["bKGD", "Background color", false, function (chunk, earlier) {
                    if (earlier.some(function (ch) { return ch.typeStr == "IDAT"; }))
                        chunk.errorNotes.push("Chunk must be before IDAT chunk");
                }],
            ["cHRM", "Primary chromaticities", false, function (chunk, earlier) {
                    if (earlier.some(function (ch) { return ch.typeStr == "PLTE"; }))
                        chunk.errorNotes.push("Chunk must be before PLTE chunk");
                    if (earlier.some(function (ch) { return ch.typeStr == "IDAT"; }))
                        chunk.errorNotes.push("Chunk must be before IDAT chunk");
                    if (chunk.data.length != 32) {
                        chunk.errorNotes.push("Invalid data length");
                        return;
                    }
                    var offset = 0;
                    for (var _i = 0, _a = ["White point", "Red", "Green", "Blue"]; _i < _a.length; _i++) {
                        var item = _a[_i];
                        for (var _b = 0, _c = ["x", "y"]; _b < _c.length; _b++) {
                            var axis = _c[_b];
                            var val = readUint32(chunk.data, offset);
                            var s = val.toString().padStart(6, "0");
                            s = s.substring(0, s.length - 5) + "." + s.substring(s.length - 5);
                            // s basically equals (val/100000).toFixed(5)
                            chunk.innerNotes.push(item + " " + axis + ": " + s);
                            offset += 4;
                        }
                    }
                }],
            ["dSIG", "Digital signature", true, function (chunk, earlier) { }],
            ["eXIf", "Exchangeable Image File (Exif) Profile", false, function (chunk, earlier) { }],
            ["fRAc", "Fractal image parameters", true, function (chunk, earlier) { }],
            ["gAMA", "Image gamma", false, function (chunk, earlier) {
                    if (earlier.some(function (ch) { return ch.typeStr == "PLTE"; }))
                        chunk.errorNotes.push("Chunk must be before PLTE chunk");
                    if (earlier.some(function (ch) { return ch.typeStr == "IDAT"; }))
                        chunk.errorNotes.push("Chunk must be before IDAT chunk");
                    if (chunk.data.length != 4) {
                        chunk.errorNotes.push("Invalid data length");
                        return;
                    }
                    var gamma = readUint32(chunk.data, 0);
                    var s = gamma.toString().padStart(6, "0");
                    s = s.substring(0, s.length - 5) + "." + s.substring(s.length - 5);
                    // s basically equals (gamma/100000).toFixed(5)
                    chunk.innerNotes.push("Gamma: " + s);
                }],
            ["gIFg", "GIF Graphic Control Extension", true, function (chunk, earlier) {
                    if (chunk.data.length != 4) {
                        chunk.errorNotes.push("Invalid data length");
                        return;
                    }
                    var disposalMethod = chunk.data[0];
                    var userInputFlag = chunk.data[1];
                    var delayTime = readUint16(chunk.data, 2);
                    chunk.innerNotes.push("Disposal method: " + disposalMethod);
                    chunk.innerNotes.push("User input flag: " + userInputFlag);
                    var s = delayTime.toString().padStart(3, "0");
                    s = s.substring(0, s.length - 2) + "." + s.substring(s.length - 2);
                    // s basically equals (delayTime/100).toFixed(2)
                    chunk.innerNotes.push("Delay time: " + s + " s");
                }],
            ["gIFt", "GIF Plain Text Extension", true, function (chunk, earlier) {
                    if (chunk.data.length < 24) {
                        chunk.errorNotes.push("Invalid data length");
                        return;
                    }
                    var gridLeft = readInt32(chunk.data, 0);
                    var gridTop = readInt32(chunk.data, 4);
                    var gridWidth = readInt32(chunk.data, 8);
                    var gridHeight = readInt32(chunk.data, 12);
                    var cellWidth = chunk.data[16];
                    var cellHeight = chunk.data[17];
                    var foregroundColor = chunk.data[18] << 16 | chunk.data[19] << 8 | chunk.data[20] << 0;
                    var backgroundColor = chunk.data[21] << 16 | chunk.data[22] << 8 | chunk.data[23] << 0;
                    var text = bytesToReadableString(chunk.data.subarray(24));
                    chunk.innerNotes.push("Deprecated");
                    chunk.innerNotes.push("Text grid left position: " + gridLeft);
                    chunk.innerNotes.push("Text grid top position: " + gridTop);
                    chunk.innerNotes.push("Text grid width: " + gridWidth);
                    chunk.innerNotes.push("Text grid height: " + gridHeight);
                    chunk.innerNotes.push("Character cell width: " + cellWidth);
                    chunk.innerNotes.push("Character cell height: " + cellHeight);
                    chunk.innerNotes.push("Text foreground color: #" + foregroundColor.toString(16).padStart(2, "0"));
                    chunk.innerNotes.push("Text background color: #" + backgroundColor.toString(16).padStart(2, "0"));
                    chunk.innerNotes.push("Plain text data: " + text);
                }],
            ["gIFx", "GIF Application Extension", true, function (chunk, earlier) {
                    if (chunk.data.length < 11) {
                        chunk.errorNotes.push("Invalid data length");
                        return;
                    }
                    chunk.innerNotes.push("Application identifier: " + bytesToReadableString(chunk.data.subarray(0, 8)));
                    {
                        var hex = [];
                        for (var i = 0; i < 3; i++)
                            hex.push(chunk.data[8 + i].toString(16).padStart(2, "0"));
                        chunk.innerNotes.push("Authentication code: " + hex.join(" "));
                    }
                    {
                        var hex = [];
                        for (var _i = 0, _a = chunk.data.subarray(11); _i < _a.length; _i++) {
                            var b = _a[_i];
                            hex.push(b.toString(16).padStart(2, "0"));
                        }
                        chunk.innerNotes.push("Application data: " + hex.join(" "));
                    }
                }],
            ["hIST", "Palette histogram", false, function (chunk, earlier) {
                    if (earlier.some(function (ch) { return ch.typeStr == "IDAT"; }))
                        chunk.errorNotes.push("Chunk must be before IDAT chunk");
                    if (!earlier.some(function (ch) { return ch.typeStr == "PLTE"; }))
                        chunk.errorNotes.push("Chunk requires earlier PLTE chunk");
                    if (chunk.data.length % 2 != 0 || chunk.data.length / 2 > 256) {
                        chunk.errorNotes.push("Invalid data length");
                        return;
                    }
                }],
            ["iCCP", "Embedded ICC profile", false, function (chunk, earlier) {
                    if (earlier.some(function (ch) { return ch.typeStr == "PLTE"; }))
                        chunk.errorNotes.push("Chunk must be before PLTE chunk");
                    if (earlier.some(function (ch) { return ch.typeStr == "IDAT"; }))
                        chunk.errorNotes.push("Chunk must be before IDAT chunk");
                    if (earlier.some(function (ch) { return ch.typeStr == "sRGB"; }))
                        chunk.errorNotes.push("Chunk should not exist because sRGB chunk exists");
                }],
            ["IDAT", "Image data", true, function (chunk, earlier) {
                    if (earlier.length > 0 && earlier[earlier.length - 1].typeStr != "IDAT"
                        && earlier.some(function (ch) { return ch.typeStr == "IDAT"; })) {
                        chunk.errorNotes.push("Non-consecutive IDAT chunk");
                    }
                }],
            ["IEND", "Image trailer", false, function (chunk, earlier) {
                    if (chunk.data.length != 0)
                        chunk.errorNotes.push("Non-empty data");
                }],
            ["IHDR", "Image header", false, function (chunk, earlier) {
                    if (chunk.data.length != 13) {
                        chunk.errorNotes.push("Invalid data length");
                        return;
                    }
                    var width = readUint32(chunk.data, 0);
                    var height = readUint32(chunk.data, 4);
                    var bitDepth = chunk.data[8];
                    var colorType = chunk.data[9];
                    var compMeth = chunk.data[10];
                    var filtMeth = chunk.data[11];
                    var laceMeth = chunk.data[12];
                    chunk.innerNotes.push("Width: " + width + " pixels");
                    if (width == 0 || width > 0x7FFFFFFF)
                        chunk.errorNotes.push("Width out of range");
                    chunk.innerNotes.push("Height: " + height + " pixels");
                    if (height == 0 || height > 0x7FFFFFFF)
                        chunk.errorNotes.push("Height out of range");
                    {
                        var colorTypeStr = void 0;
                        var validBitDepths = void 0;
                        var temp = lookUpTable(colorType, [
                            [0, ["Grayscale", [1, 2, 4, 8, 16]]],
                            [2, ["RGB", [8, 16]]],
                            [3, ["Palette", [1, 2, 4, 8]]],
                            [4, ["Grayscale+Alpha", [8, 16]]],
                            [6, ["RGBA", [8, 16]]],
                        ]);
                        colorTypeStr = temp !== null ? temp[0] : "Unknown";
                        validBitDepths = temp !== null ? temp[1] : [];
                        chunk.innerNotes.push("Bit depth: " + bitDepth + " bits per " + (colorType != 3 ? "channel" : "pixel"));
                        chunk.innerNotes.push("Color type: " + colorTypeStr + " (" + colorType + ")");
                        if (temp === null)
                            chunk.errorNotes.push("Unknown color type");
                        else if (validBitDepths.indexOf(bitDepth) == -1)
                            chunk.errorNotes.push("Invalid bit depth");
                    }
                    {
                        var s = lookUpTable(compMeth, [
                            [0, "DEFLATE"],
                        ]);
                        if (s === null) {
                            s = "Unknown";
                            chunk.errorNotes.push("Unknown compression method");
                        }
                        chunk.innerNotes.push("Compression method: " + s + " (" + compMeth + ")");
                    }
                    {
                        var s = lookUpTable(filtMeth, [
                            [0, "Adaptive"],
                        ]);
                        if (s === null) {
                            s = "Unknown";
                            chunk.errorNotes.push("Unknown filter method");
                        }
                        chunk.innerNotes.push("Filter method: " + s + " (" + filtMeth + ")");
                    }
                    {
                        var s = lookUpTable(laceMeth, [
                            [0, "None"],
                            [1, "Adam7"],
                        ]);
                        if (s === null) {
                            s = "Unknown";
                            chunk.errorNotes.push("Unknown interlace method");
                        }
                        chunk.innerNotes.push("Interlace method: " + s + " (" + laceMeth + ")");
                    }
                }],
            ["iTXt", "International textual data", true, function (chunk, earlier) {
                    var data = [];
                    for (var _i = 0, _a = chunk.data; _i < _a.length; _i++) {
                        var b = _a[_i];
                        data.push(b);
                    }
                    var dataIndex = 0;
                    function parseNullTerminatedBytes() {
                        var nulIndex = data.indexOf(0, dataIndex);
                        var result;
                        if (nulIndex != -1) {
                            result = data.slice(dataIndex, nulIndex);
                            dataIndex = nulIndex + 1;
                        }
                        else {
                            result = data.slice(dataIndex);
                            dataIndex = data.length;
                        }
                        return result;
                    }
                    var compFlag = null;
                    var compMeth = null;
                    loop: for (var state = 0; state < 6; state++) {
                        switch (state) {
                            case 0: {
                                var keyword = decodeIso8859_1(parseNullTerminatedBytes());
                                annotateTextKeyword(keyword, chunk);
                                if (dataIndex == data.length) {
                                    chunk.errorNotes.push("Missing null separator");
                                    break loop;
                                }
                                break;
                            }
                            case 1: {
                                if (dataIndex == data.length) {
                                    chunk.errorNotes.push("Missing compression flag");
                                    break loop;
                                }
                                compFlag = data[dataIndex];
                                dataIndex++;
                                var s = lookUpTable(compFlag, [
                                    [0, "Uncompressed"],
                                    [1, "Compressed"],
                                ]);
                                if (s === null) {
                                    s = "Unknown";
                                    chunk.errorNotes.push("Unknown compression flag");
                                }
                                chunk.innerNotes.push("Compression flag: " + s + " (" + compFlag + ")");
                                break;
                            }
                            case 2: {
                                if (dataIndex == data.length) {
                                    chunk.errorNotes.push("Missing compression method");
                                    break loop;
                                }
                                compMeth = data[dataIndex];
                                dataIndex++;
                                var s = lookUpTable(compMeth, [
                                    [0, "DEFLATE"],
                                ]);
                                if (s === null) {
                                    s = "Unknown";
                                    chunk.errorNotes.push("Unknown compression method");
                                }
                                chunk.innerNotes.push("Compression method: " + s + " (" + compMeth + ")");
                                break;
                            }
                            case 3: {
                                var bytes = parseNullTerminatedBytes();
                                var langTag = null;
                                try {
                                    langTag = decodeUtf8(bytes);
                                }
                                catch (e) {
                                    chunk.errorNotes.push("Invalid UTF-8 in language tag");
                                }
                                if (langTag !== null)
                                    chunk.innerNotes.push("Language tag: " + langTag);
                                if (dataIndex == data.length) {
                                    chunk.errorNotes.push("Missing null separator");
                                    break loop;
                                }
                                break;
                            }
                            case 4: {
                                var bytes = parseNullTerminatedBytes();
                                var transKey = null;
                                try {
                                    transKey = decodeUtf8(bytes);
                                }
                                catch (e) {
                                    chunk.errorNotes.push("Invalid UTF-8 in translated keyword");
                                }
                                if (transKey !== null)
                                    chunk.innerNotes.push("Translated keyword: " + transKey);
                                if (dataIndex == data.length) {
                                    chunk.errorNotes.push("Missing null separator");
                                    break loop;
                                }
                                break;
                            }
                            case 5: {
                                var textBytes = data.slice(dataIndex);
                                if (compFlag === 1) {
                                    if (compMeth == 0) {
                                        try {
                                            textBytes = deflate.decompressZlib(textBytes);
                                        }
                                        catch (e) {
                                            chunk.errorNotes.push("Text decompression error: " + e);
                                            break;
                                        }
                                    }
                                    else
                                        break;
                                }
                                var text = void 0;
                                try {
                                    text = decodeUtf8(textBytes);
                                }
                                catch (e) {
                                    chunk.errorNotes.push("Invalid UTF-8 in translated keyword");
                                    break;
                                }
                                var frag = document.createDocumentFragment();
                                frag.appendChild(document.createTextNode("Text string: "));
                                var span = appendElem(frag, "span", text);
                                span.style.wordBreak = "break-all";
                                chunk.innerNotes.push(frag);
                                break;
                            }
                            default:
                                throw "Assertion error";
                        }
                    }
                }],
            ["oFFs", "Image offset", false, function (chunk, earlier) {
                    if (earlier.some(function (ch) { return ch.typeStr == "IDAT"; }))
                        chunk.errorNotes.push("Chunk must be before IDAT chunk");
                    if (chunk.data.length != 9) {
                        chunk.errorNotes.push("Invalid data length");
                        return;
                    }
                    var xPos = readInt32(chunk.data, 0);
                    var yPos = readInt32(chunk.data, 4);
                    var unit = chunk.data[8];
                    chunk.innerNotes.push("X position: " + xPos + " units");
                    chunk.innerNotes.push("Y position: " + yPos + " units");
                    {
                        var s = lookUpTable(unit, [
                            [0, "Pixel"],
                            [1, "Micrometre"],
                        ]);
                        if (s === null) {
                            s = "Unknown";
                            chunk.errorNotes.push("Unknown unit specifier");
                        }
                        chunk.innerNotes.push("Unit specifier: " + s + " (" + unit + ")");
                    }
                }],
            ["pCAL", "Calibration of pixel values", false, function (chunk, earlier) {
                    if (earlier.some(function (ch) { return ch.typeStr == "IDAT"; }))
                        chunk.errorNotes.push("Chunk must be before IDAT chunk");
                }],
            ["pHYs", "Physical pixel dimensions", false, function (chunk, earlier) {
                    if (earlier.some(function (ch) { return ch.typeStr == "IDAT"; }))
                        chunk.errorNotes.push("Chunk must be before IDAT chunk");
                    if (chunk.data.length != 9) {
                        chunk.errorNotes.push("Invalid data length");
                        return;
                    }
                    var horzRes = readUint32(chunk.data, 0);
                    var vertRes = readUint32(chunk.data, 4);
                    var unit = chunk.data[8];
                    for (var _i = 0, _a = [["Horizontal", horzRes], ["Vertical", vertRes]]; _i < _a.length; _i++) {
                        var _b = _a[_i], dir = _b[0], val = _b[1];
                        var frag = document.createDocumentFragment();
                        frag.appendChild(document.createTextNode(dir + " resolution: " + val + " pixels per unit"));
                        if (unit == 1) {
                            frag.appendChild(document.createTextNode(" (\u2248 " + (val * 0.0254).toFixed(0) + " "));
                            var abbr = appendElem(frag, "abbr", "DPI");
                            abbr.title = "dots per inch";
                            frag.appendChild(document.createTextNode(")"));
                        }
                        chunk.innerNotes.push(frag);
                    }
                    {
                        var s = lookUpTable(unit, [
                            [0, "Arbitrary (aspect ratio only)"],
                            [1, "Metre"],
                        ]);
                        if (s === null) {
                            s = "Unknown";
                            chunk.errorNotes.push("Unknown unit specifier");
                        }
                        chunk.innerNotes.push("Unit specifier: " + s + " (" + unit + ")");
                    }
                }],
            ["PLTE", "Palette", false, function (chunk, earlier) {
                    if (earlier.some(function (ch) { return ch.typeStr == "bKGD"; }))
                        chunk.errorNotes.push("Chunk must be before bKGD chunk");
                    if (earlier.some(function (ch) { return ch.typeStr == "hIST"; }))
                        chunk.errorNotes.push("Chunk must be before hIST chunk");
                    if (earlier.some(function (ch) { return ch.typeStr == "tRNS"; }))
                        chunk.errorNotes.push("Chunk must be before tRNS chunk");
                    if (earlier.some(function (ch) { return ch.typeStr == "IDAT"; }))
                        chunk.errorNotes.push("Chunk must be before IDAT chunk");
                }],
            ["sCAL", "Physical scale of image subject", false, function (chunk, earlier) {
                    if (earlier.some(function (ch) { return ch.typeStr == "IDAT"; }))
                        chunk.errorNotes.push("Chunk must be before IDAT chunk");
                }],
            ["sBIT", "Significant bits", false, function (chunk, earlier) {
                    if (earlier.some(function (ch) { return ch.typeStr == "PLTE"; }))
                        chunk.errorNotes.push("Chunk must be before PLTE chunk");
                    if (earlier.some(function (ch) { return ch.typeStr == "IDAT"; }))
                        chunk.errorNotes.push("Chunk must be before IDAT chunk");
                    if (chunk.data.length == 0 || chunk.data.length > 4)
                        chunk.errorNotes.push("Invalid data length");
                    var temp = [];
                    for (var _i = 0, _a = chunk.data; _i < _a.length; _i++) {
                        var b = _a[_i];
                        temp.push(b.toString());
                    }
                    chunk.innerNotes.push("Significant bits per channel: " + temp.join(", "));
                }],
            ["sPLT", "Suggested palette", true, function (chunk, earlier) {
                    if (earlier.some(function (ch) { return ch.typeStr == "IDAT"; }))
                        chunk.errorNotes.push("Chunk must be before IDAT chunk");
                }],
            ["sRGB", "Standard RGB color space", false, function (chunk, earlier) {
                    if (earlier.some(function (ch) { return ch.typeStr == "PLTE"; }))
                        chunk.errorNotes.push("Chunk must be before PLTE chunk");
                    if (earlier.some(function (ch) { return ch.typeStr == "IDAT"; }))
                        chunk.errorNotes.push("Chunk must be before IDAT chunk");
                    if (earlier.some(function (ch) { return ch.typeStr == "iCCP"; }))
                        chunk.errorNotes.push("Chunk should not exist because iCCP chunk exists");
                    if (chunk.data.length != 1) {
                        chunk.errorNotes.push("Invalid data length");
                        return;
                    }
                    var renderIntent = chunk.data[0];
                    var s = lookUpTable(renderIntent, [
                        [0, "Perceptual"],
                        [1, "Relative colorimetric"],
                        [2, "Saturation"],
                        [3, "Absolute colorimetric"],
                    ]);
                    if (s === null) {
                        s = "Unknown";
                        chunk.errorNotes.push("Unknown rendering intent");
                    }
                    chunk.innerNotes.push("Rendering intent: " + s + " (" + renderIntent + ")");
                }],
            ["sTER", "Indicator of Stereo Image", false, function (chunk, earlier) {
                    if (earlier.some(function (ch) { return ch.typeStr == "IDAT"; }))
                        chunk.errorNotes.push("Chunk must be before IDAT chunk");
                    if (chunk.data.length != 1) {
                        chunk.errorNotes.push("Invalid data length");
                        return;
                    }
                    var mode = chunk.data[0];
                    var s = lookUpTable(mode, [
                        [0, "Cross-fuse layout"],
                        [1, "Diverging-fuse layout"],
                    ]);
                    if (s === null) {
                        s = "Unknown";
                        chunk.errorNotes.push("Unknown mode");
                    }
                    chunk.innerNotes.push("Mode: " + s + " (" + mode + ")");
                }],
            ["tEXt", "Textual data", true, function (chunk, earlier) {
                    var data = [];
                    for (var _i = 0, _a = chunk.data; _i < _a.length; _i++) {
                        var b = _a[_i];
                        data.push(b);
                    }
                    var separatorIndex = data.indexOf(0);
                    if (separatorIndex == -1) {
                        chunk.errorNotes.push("Missing null separator");
                        var keyword = decodeIso8859_1(data);
                        annotateTextKeyword(keyword, chunk);
                    }
                    else {
                        var keyword = decodeIso8859_1(data.slice(0, separatorIndex));
                        annotateTextKeyword(keyword, chunk);
                        var text = decodeIso8859_1(data.slice(separatorIndex + 1));
                        chunk.innerNotes.push("Text string: " + text);
                        if (text.indexOf("\u0000") != -1)
                            chunk.errorNotes.push("Null character in text string");
                        if (text.indexOf("\uFFFD") != -1)
                            chunk.errorNotes.push("Invalid ISO 8859-1 byte in text string");
                    }
                }],
            ["tIME", "Image last-modification time", false, function (chunk, earlier) {
                    if (chunk.data.length != 7) {
                        chunk.errorNotes.push("Invalid data length");
                        return;
                    }
                    var year = readUint16(chunk.data, 0);
                    var month = chunk.data[2];
                    var day = chunk.data[3];
                    var hour = chunk.data[4];
                    var minute = chunk.data[5];
                    var second = chunk.data[6];
                    chunk.innerNotes.push("Year: " + year);
                    chunk.innerNotes.push("Month: " + month);
                    chunk.innerNotes.push("Day: " + day);
                    chunk.innerNotes.push("Hour: " + hour);
                    chunk.innerNotes.push("Minute: " + minute);
                    chunk.innerNotes.push("Second: " + second);
                    if (!(1 <= month && month <= 12))
                        chunk.errorNotes.push("Invalid month");
                    if (!(1 <= day && day <= 31))
                        chunk.errorNotes.push("Invalid day");
                    if (!(0 <= hour && hour <= 23))
                        chunk.errorNotes.push("Invalid hour");
                    if (!(0 <= minute && minute <= 59))
                        chunk.errorNotes.push("Invalid minute");
                    if (!(0 <= second && second <= 60))
                        chunk.errorNotes.push("Invalid second");
                }],
            ["tRNS", "Transparency", false, function (chunk, earlier) {
                    if (earlier.some(function (ch) { return ch.typeStr == "IDAT"; }))
                        chunk.errorNotes.push("Chunk must be before IDAT chunk");
                }],
            ["zTXt", "Compressed textual data", true, function (chunk, earlier) {
                    var data = [];
                    for (var _i = 0, _a = chunk.data; _i < _a.length; _i++) {
                        var b = _a[_i];
                        data.push(b);
                    }
                    var separatorIndex = data.indexOf(0);
                    if (separatorIndex == -1) {
                        chunk.errorNotes.push("Missing null separator");
                        var keyword = decodeIso8859_1(data);
                        annotateTextKeyword(keyword, chunk);
                    }
                    else {
                        var keyword = decodeIso8859_1(data.slice(0, separatorIndex));
                        annotateTextKeyword(keyword, chunk);
                        if (separatorIndex + 1 >= data.length)
                            chunk.errorNotes.push("Missing compression method");
                        else {
                            var compMeth = data[separatorIndex + 1];
                            var s = lookUpTable(compMeth, [
                                [0, "DEFLATE"],
                            ]);
                            if (s === null) {
                                s = "Unknown";
                                chunk.errorNotes.push("Unknown compression method");
                            }
                            chunk.innerNotes.push("Compression method: " + s + " (" + compMeth + ")");
                            if (compMeth == 0) {
                                try {
                                    var textBytes = deflate.decompressZlib(data.slice(separatorIndex + 2));
                                    var text = decodeIso8859_1(textBytes);
                                    var frag = document.createDocumentFragment();
                                    frag.appendChild(document.createTextNode("Text string: "));
                                    var span = appendElem(frag, "span", text);
                                    span.style.wordBreak = "break-all";
                                    chunk.innerNotes.push(frag);
                                    if (text.indexOf("\uFFFD") != -1)
                                        chunk.errorNotes.push("Invalid ISO 8859-1 byte in text string");
                                }
                                catch (e) {
                                    chunk.errorNotes.push("Text decompression error: " + e);
                                }
                            }
                        }
                    }
                }],
        ];
        return ChunkPart;
    }(FilePart));
    /*---- Utility functions ----*/
    function annotateTextKeyword(keyword, chunk) {
        chunk.innerNotes.push("Keyword: " + keyword);
        if (!(1 <= keyword.length || keyword.length <= 79))
            chunk.errorNotes.push("Invalid keyword length");
        for (var i = 0; i < keyword.length; i++) {
            var c = keyword.charCodeAt(i);
            if (0x20 <= c && c <= 0x7E || 0xA1 <= c && c <= 0xFF)
                continue;
            else {
                chunk.errorNotes.push("Invalid character in keyword");
                break;
            }
        }
        if (keyword.indexOf(" ") == 0 || keyword.lastIndexOf(" ") == keyword.length - 1 || keyword.indexOf("  ") != -1)
            chunk.errorNotes.push("Invalid space in keyword");
    }
    function calcCrc32(bytes) {
        var crc = ~0;
        for (var _i = 0, bytes_2 = bytes; _i < bytes_2.length; _i++) {
            var b = bytes_2[_i];
            for (var i = 0; i < 8; i++) {
                crc ^= (b >>> i) & 1;
                crc = (crc >>> 1) ^ (-(crc & 1) & 0xEDB88320);
            }
        }
        return ~crc >>> 0;
    }
    function bytesToReadableString(bytes) {
        var result = "";
        for (var _i = 0, bytes_3 = bytes; _i < bytes_3.length; _i++) {
            var b = bytes_3[_i];
            var cc = b;
            if (b < 0x20)
                cc += 0x2400;
            else if (b == 0x7F)
                cc = 0x2421;
            else if (0x80 <= b && b < 0xA0)
                cc = 0x25AF;
            result += String.fromCharCode(cc);
        }
        return result;
    }
    function decodeIso8859_1(bytes) {
        var result = "";
        for (var _i = 0, bytes_4 = bytes; _i < bytes_4.length; _i++) {
            var b = bytes_4[_i];
            if (!(0x00 <= b && b <= 0xFF))
                throw "Invalid byte";
            else if (0x80 <= b && b < 0xA0)
                result += "\uFFFD";
            else
                result += String.fromCharCode(b); // ISO 8859-1 is a subset of Unicode
        }
        return result;
    }
    function decodeUtf8(bytes) {
        var temp = "";
        for (var _i = 0, bytes_5 = bytes; _i < bytes_5.length; _i++) {
            var b = bytes_5[_i];
            if (b == "%".charCodeAt(0) || b >= 128)
                temp += "%" + b.toString(16).padStart(2, "0");
            else
                temp += String.fromCharCode(b);
        }
        return decodeURI(temp);
    }
    function uintToStrWithThousandsSeparators(val) {
        if (val < 0 || Math.floor(val) != val)
            throw "Invalid unsigned integer";
        var result = val.toString();
        for (var i = result.length - 3; i > 0; i -= 3)
            result = result.substring(0, i) + "\u00A0" + result.substring(i);
        return result;
    }
    function appendElem(container, tagName, text) {
        var result = document.createElement(tagName);
        container.appendChild(result);
        if (text !== undefined)
            result.textContent = text;
        return result;
    }
    function lookUpTable(key, table) {
        var result = null;
        for (var _i = 0, table_1 = table; _i < table_1.length; _i++) {
            var _a = table_1[_i], k = _a[0], v = _a[1];
            if (k == key) {
                if (result !== null)
                    throw "Table has duplicate keys";
                result = v;
            }
        }
        return result;
    }
    function readUint16(bytes, offset) {
        if (bytes.length - offset < 2)
            throw "Index out of range";
        return bytes[offset + 0] << 8
            | bytes[offset + 1] << 0;
    }
    function readUint32(bytes, offset) {
        if (offset < 0 || bytes.length - offset < 4)
            throw "Index out of range";
        return (bytes[offset + 0] << 24
            | bytes[offset + 1] << 16
            | bytes[offset + 2] << 8
            | bytes[offset + 3] << 0) >>> 0;
    }
    function readInt32(bytes, offset) {
        return readUint32(bytes, offset) | 0;
    }
    function requireType(val, type) {
        if (val instanceof type)
            return val;
        else
            throw "Invalid value type";
    }
    /*---- Polyfills ----*/
    if (!("padStart" in String.prototype)) {
        String.prototype.padStart = function (len, padder) {
            var result = this;
            while (result.length < len)
                result = padder.substring(0, Math.min(len - result.length, padder.length)) + result;
            return result;
        };
    }
})(app || (app = {}));
var deflate;
(function (deflate) {
    function decompressZlib(bytes) {
        if (bytes.length < 2)
            throw "Invalid zlib container";
        var compMeth = bytes[0] & 0xF;
        var compInfo = bytes[0] >>> 4;
        var presetDict = (bytes[1] & 0x20) != 0;
        var compLevel = bytes[1] >>> 6;
        if ((bytes[0] << 8 | bytes[1]) % 31 != 0)
            throw "zlib header checksum mismatch";
        if (compMeth != 8)
            throw "Unsupported compression method (" + compMeth + ")";
        if (compInfo > 7)
            throw "Unsupported compression info (" + compInfo + ")";
        if (presetDict)
            throw "Unsupported preset dictionary";
        var _a = decompressDeflate(bytes.slice(2)), result = _a[0], input = _a[1];
        var dataAdler;
        {
            var s1 = 1;
            var s2 = 0;
            for (var _i = 0, result_3 = result; _i < result_3.length; _i++) {
                var b = result_3[_i];
                s1 = (s1 + b) % 65521;
                s2 = (s2 + s1) % 65521;
            }
            dataAdler = s2 << 16 | s1;
        }
        var storedAdler = 0;
        input.readUint((8 - input.getBitPosition()) % 8);
        for (var i = 0; i < 4; i++)
            storedAdler = storedAdler << 8 | input.readUint(8);
        if (input.readBitMaybe() != -1)
            throw "Unexpected data after zlib container";
        if (storedAdler != dataAdler)
            throw "Adler-32 mismatch";
        return result;
    }
    deflate.decompressZlib = decompressZlib;
    function decompressDeflate(bytes) {
        var input = new BitInputStream(bytes);
        var output = [];
        var dictionary = new ByteHistory(32 * 1024);
        while (true) {
            var isFinal = input.readUint(1) != 0;
            var type = input.readUint(2);
            switch (type) {
                case 0:
                    decompressUncompressedBlock();
                    break;
                case 1:
                    decompressHuffmanBlock(FIXED_LITERAL_LENGTH_CODE, FIXED_DISTANCE_CODE);
                    break;
                case 2:
                    var _a = decodeHuffmanCodes(), litLenCode = _a[0], distCode = _a[1];
                    decompressHuffmanBlock(litLenCode, distCode);
                    break;
                case 3:
                    throw "Reserved block type";
                default:
                    throw "Assertion error";
            }
            if (isFinal)
                return [output, input];
        }
        function decodeHuffmanCodes() {
            var numLitLenCodes = input.readUint(5) + 257;
            var numDistCodes = input.readUint(5) + 1;
            var numCodeLenCodes = input.readUint(4) + 4;
            var codeLenCodeLen = [];
            for (var i = 0; i < 19; i++)
                codeLenCodeLen.push(0);
            codeLenCodeLen[16] = input.readUint(3);
            codeLenCodeLen[17] = input.readUint(3);
            codeLenCodeLen[18] = input.readUint(3);
            codeLenCodeLen[0] = input.readUint(3);
            for (var i = 0; i < numCodeLenCodes - 4; i++) {
                var j = (i % 2 == 0) ? (8 + Math.floor(i / 2)) : (7 - Math.floor(i / 2));
                codeLenCodeLen[j] = input.readUint(3);
            }
            var codeLenCode = new CanonicalCode(codeLenCodeLen);
            var codeLens = [];
            while (codeLens.length < numLitLenCodes + numDistCodes) {
                var sym = codeLenCode.decodeNextSymbol(input);
                if (0 <= sym && sym <= 15)
                    codeLens.push(sym);
                else if (sym == 16) {
                    if (codeLens.length == 0)
                        throw "No code length value to copy";
                    var runLen = input.readUint(2) + 3;
                    for (var i = 0; i < runLen; i++)
                        codeLens.push(codeLens[codeLens.length - 1]);
                }
                else if (sym == 17) {
                    var runLen = input.readUint(3) + 3;
                    for (var i = 0; i < runLen; i++)
                        codeLens.push(0);
                }
                else if (sym == 18) {
                    var runLen = input.readUint(7) + 11;
                    for (var i = 0; i < runLen; i++)
                        codeLens.push(0);
                }
                else
                    throw "Symbol out of range";
            }
            if (codeLens.length > numLitLenCodes + numDistCodes)
                throw "Run exceeds number of codes";
            var litLenCode = new CanonicalCode(codeLens.slice(0, numLitLenCodes));
            var distCodeLen = codeLens.slice(numLitLenCodes);
            var distCode;
            if (distCodeLen.length == 1 && distCodeLen[0] == 0)
                distCode = null;
            else {
                var oneCount = distCodeLen.filter(function (x) { return x == 1; }).length;
                var otherPositiveCount = distCodeLen.filter(function (x) { return x > 1; }).length;
                if (oneCount == 1 && otherPositiveCount == 0) {
                    while (distCodeLen.length < 32)
                        distCodeLen.push(0);
                    distCodeLen[31] = 1;
                }
                distCode = new CanonicalCode(distCodeLen);
            }
            return [litLenCode, distCode];
        }
        function decompressUncompressedBlock() {
            input.readUint((8 - input.getBitPosition()) % 8);
            var len = input.readUint(16);
            var nlen = input.readUint(16);
            if ((len ^ 0xFFFF) != nlen)
                throw "Invalid length in uncompressed block";
            for (var i = 0; i < len; i++) {
                var b = input.readUint(8);
                output.push(b);
                dictionary.append(b);
            }
        }
        function decompressHuffmanBlock(litLenCode, distCode) {
            while (true) {
                var sym = litLenCode.decodeNextSymbol(input);
                if (sym == 256)
                    break;
                else if (sym < 256) {
                    output.push(sym);
                    dictionary.append(sym);
                }
                else {
                    var run = decodeRunLength(sym);
                    if (!(3 <= run && run <= 258))
                        throw "Invalid run length";
                    if (distCode === null)
                        throw "Length symbol encountered with empty distance code";
                    var distSym = distCode.decodeNextSymbol(input);
                    var dist = decodeDistance(distSym);
                    if (!(1 <= dist && dist <= 32768))
                        throw "Invalid distance";
                    dictionary.copy(dist, run, output);
                }
            }
        }
        function decodeRunLength(sym) {
            if (!(257 <= sym && sym <= 287))
                throw "Invalid run length symbol";
            if (sym <= 264)
                return sym - 254;
            else if (sym <= 284) {
                var numExtraBits = Math.floor((sym - 261) / 4);
                return (((sym - 265) % 4 + 4) << numExtraBits) + 3 + input.readUint(numExtraBits);
            }
            else if (sym == 285)
                return 258;
            else
                throw "Reserved length symbol";
        }
        function decodeDistance(sym) {
            if (!(0 <= sym && sym <= 31))
                throw "Invalid distance symbol";
            if (sym <= 3)
                return sym + 1;
            else if (sym <= 29) {
                var numExtraBits = Math.floor(sym / 2) - 1;
                return ((sym % 2 + 2) << numExtraBits) + 1 + input.readUint(numExtraBits);
            }
            else
                throw "Reserved distance symbol";
        }
    }
    deflate.decompressDeflate = decompressDeflate;
    var CanonicalCode = /** @class */ (function () {
        function CanonicalCode(codeLengths) {
            var _this = this;
            this.codeBitsToSymbol = new Map();
            var nextCode = 0;
            var _loop_2 = function (codeLength) {
                nextCode <<= 1;
                var startBit = 1 << codeLength;
                codeLengths.forEach(function (cl, symbol) {
                    if (cl != codeLength)
                        return;
                    if (nextCode >= startBit)
                        throw "This canonical code produces an over-full Huffman code tree";
                    _this.codeBitsToSymbol.set(startBit | nextCode, symbol);
                    nextCode++;
                });
            };
            for (var codeLength = 1; codeLength <= CanonicalCode.MAX_CODE_LENGTH; codeLength++) {
                _loop_2(codeLength);
            }
            if (nextCode != 1 << CanonicalCode.MAX_CODE_LENGTH)
                throw "This canonical code produces an under-full Huffman code tree";
        }
        CanonicalCode.prototype.decodeNextSymbol = function (inp) {
            var codeBits = 1;
            while (true) {
                codeBits = codeBits << 1 | inp.readUint(1);
                var result = this.codeBitsToSymbol.get(codeBits);
                if (result !== undefined)
                    return result;
            }
        };
        CanonicalCode.MAX_CODE_LENGTH = 15;
        return CanonicalCode;
    }());
    var FIXED_LITERAL_LENGTH_CODE;
    {
        var codeLens = [];
        for (var i = 0; i < 144; i++)
            codeLens.push(8);
        for (var i = 0; i < 112; i++)
            codeLens.push(9);
        for (var i = 0; i < 24; i++)
            codeLens.push(7);
        for (var i = 0; i < 8; i++)
            codeLens.push(8);
        FIXED_LITERAL_LENGTH_CODE = new CanonicalCode(codeLens);
    }
    var FIXED_DISTANCE_CODE;
    {
        var codeLens = [];
        for (var i = 0; i < 32; i++)
            codeLens.push(5);
        FIXED_DISTANCE_CODE = new CanonicalCode(codeLens);
    }
    var ByteHistory = /** @class */ (function () {
        function ByteHistory(size) {
            this.index = 0;
            if (size < 1)
                throw "Size must be positive";
            this.data = new Uint8Array(size);
        }
        ByteHistory.prototype.append = function (b) {
            if (!(0 <= this.index && this.index < this.data.length))
                throw "Assertion error";
            this.data[this.index] = b;
            this.index = (this.index + 1) % this.data.length;
        };
        ByteHistory.prototype.copy = function (dist, count, out) {
            if (count < 0 || !(1 <= dist && dist <= this.data.length))
                throw "Invalid argument";
            var readIndex = (this.index + this.data.length - dist) % this.data.length;
            for (var i = 0; i < count; i++) {
                var b = this.data[readIndex];
                readIndex = (readIndex + 1) % this.data.length;
                out.push(b);
                this.append(b);
            }
        };
        return ByteHistory;
    }());
    var BitInputStream = /** @class */ (function () {
        function BitInputStream(data) {
            this.data = data;
            this.bitIndex = 0;
        }
        BitInputStream.prototype.getBitPosition = function () {
            return this.bitIndex % 8;
        };
        BitInputStream.prototype.readBitMaybe = function () {
            var byteIndex = this.bitIndex >>> 3;
            if (byteIndex >= this.data.length)
                return -1;
            var result = ((this.data[byteIndex] >>> (this.bitIndex & 7)) & 1);
            this.bitIndex++;
            return result;
        };
        BitInputStream.prototype.readUint = function (numBits) {
            if (numBits < 0)
                throw "Invalid argument";
            var result = 0;
            for (var i = 0; i < numBits; i++) {
                var bit = this.readBitMaybe();
                if (bit == -1)
                    throw "Unexpected end of data";
                result |= bit << i;
            }
            return result;
        };
        return BitInputStream;
    }());
})(deflate || (deflate = {}));
