/* 
 * PNG file chunk inspector (TypeScript)
 * 
 * Copyright (c) 2021 Project Nayuki
 * All rights reserved. Contact Nayuki for licensing.
 * https://www.nayuki.io/page/png-file-chunk-inspector
 */


type byte = number;
type int = number;


namespace app {
	
	/*---- Graphical user interface ----*/
	
	function initialize(): void {
		let fileElem = requireType(document.querySelector("article input[type=file]"), HTMLInputElement);
		fileElem.onchange = (): void => {
			const files: FileList|null = fileElem.files;
			if (files === null || files.length < 1)
				return;
			let reader = new FileReader();
			reader.onload = (): void => {
				const bytes = requireType(reader.result, ArrayBuffer);
				visualizeFile(new Uint8Array(bytes));
			};
			reader.readAsArrayBuffer(files[0]);
		};
	}
	
	setTimeout(initialize);
	
	
	function visualizeFile(fileBytes: Uint8Array): void {
		let table = requireType(document.querySelector("article table"), HTMLElement);
		table.classList.remove("errors");
		let tbody = requireType(table.querySelector("tbody"), HTMLElement);
		while (tbody.firstChild !== null)
			tbody.removeChild(tbody.firstChild);
		
		const parts: Array<FilePart> = parseFile(fileBytes);
		let summary: string = "";
		for (let i = 0; i < parts.length; i++) {
			const part: FilePart = parts[i];
			if (part instanceof ChunkPart) {
				if (summary != "")
					summary += ", ";
				summary += part.typeStr;
				if (part.typeStr == "IDAT") {
					let count: int = 1;
					for (; i + 1 < parts.length; i++, count++) {
						let nextPart: FilePart = parts[i + 1];
						if (!(nextPart instanceof ChunkPart) || nextPart.typeStr != "IDAT")
							break;
					}
					if (count > 1)
						summary += " \u00D7" + count;
				}
			}
		}
		requireType(document.querySelector("article span#summary"), HTMLElement).textContent = summary;
		
		for (const part of parts) {
			let tr: HTMLElement = appendElem(tbody, "tr");
			appendElem(tr, "td", uintToStrWithThousandsSeparators(part.offset));
			
			{
				let td: HTMLElement = appendElem(tr, "td");
				let hex: Array<string> = [];
				const bytes: Uint8Array = part.bytes;
				const pushHex = function(index: int): void {
					hex.push(bytes[index].toString(16).padStart(2, "0"));
				};
				
				if (bytes.length <= 100) {
					for (let i = 0; i < bytes.length; i++)
						pushHex(i);
				} else {
					for (let i = 0; i < 70; i++)
						pushHex(i);
					hex.push("...");
					for (let i = bytes.length - 30; i < bytes.length; i++)
						pushHex(i);
				}
				appendElem(td, "code", hex.join(" "));
			}
			
			for (const list of [part.outerNotes, part.innerNotes, part.errorNotes]) {
				let td: HTMLElement = appendElem(tr, "td");
				let ul: HTMLElement = appendElem(td, "ul");
				for (const item of list) {
					if (list == part.errorNotes)
						table.classList.add("errors");
					let li: HTMLElement = appendElem(ul, "li");
					if (typeof item == "string")
						li.textContent = item;
					else if (item instanceof Node)
						li.appendChild(item);
					else
						throw "Assertion error";
				}
			}
		}
	}
	
	
	
	/*---- PNG file parser ----*/
	
	function parseFile(fileBytes: Uint8Array): Array<FilePart> {
		let result: Array<FilePart> = [];
		let isSignatureValid: boolean;
		let offset: int = 0;
		
		{  // Parse file signature
			const bytes: Uint8Array = fileBytes.subarray(offset, Math.min(offset + SignaturePart.FILE_SIGNATURE.length, fileBytes.length));
			const part = new SignaturePart(offset, bytes);
			result.push(part);
			isSignatureValid = part.errorNotes.length == 0;
			offset += bytes.length;
		}
		
		if (!isSignatureValid && offset < fileBytes.length) {
			const bytes: Uint8Array = fileBytes.subarray(offset, fileBytes.length);
			let part = new UnknownPart(offset, bytes);
			part.errorNotes.push("Unknown format");
			result.push(part);
			offset += bytes.length;
			
		} else if (isSignatureValid) {
			// Parse chunks but carefully handle erroneous file structures
			while (offset < fileBytes.length) {
				// Begin by assuming that the next chunk is invalid
				let bytes: Uint8Array = fileBytes.subarray(offset, fileBytes.length);
				const remain: int = bytes.length;
				if (remain >= 4) {
					const innerLen: int = readUint32(fileBytes, offset);
					const outerLen: int = innerLen + 12;
					if (innerLen <= ChunkPart.MAX_DATA_LENGTH && outerLen <= remain)
						bytes = fileBytes.subarray(offset, offset + outerLen);  // Chunk is now valid with respect to length
				}
				result.push(new ChunkPart(offset, bytes));
				offset += bytes.length;
			}
			
			// Annotate chunks
			let earlierChunks: Array<ChunkPart> = [];
			let earlierTypes = new Set<string>();
			for (const part of result) {
				if (!(part instanceof ChunkPart))
					continue;
				
				const type: string = part.typeStr;
				if (type != "IHDR" && type != "" && !earlierTypes.has("IHDR"))
					part.errorNotes.push("Chunk must be after IHDR chunk");
				if (type != "IEND" && type != "" && earlierTypes.has("IEND"))
					part.errorNotes.push("Chunk must be before IEND chunk");
				const typeInfo = part.getTypeInfo();
				if (typeInfo !== null && !typeInfo[1] && earlierTypes.has(type))
					part.errorNotes.push("Multiple chunks of this type disallowed");
				
				part.annotate(earlierChunks);
				earlierChunks.push(part);
				earlierTypes.add(type);
			}
			
			{
				let ihdrIndex: int = 0;
				while (ihdrIndex < result.length && (!(result[ihdrIndex] instanceof ChunkPart) || (result[ihdrIndex] as ChunkPart).typeStr != "IHDR"))
					ihdrIndex++;
				let iendIndex: int = 0;
				while (iendIndex < result.length && (!(result[iendIndex] instanceof ChunkPart) || (result[iendIndex] as ChunkPart).typeStr != "IEND"))
					iendIndex++;
				
				let processedDsigs = new Set<ChunkPart>();
				if (ihdrIndex < result.length && iendIndex < result.length) {
					let start: int = ihdrIndex + 1;
					let end: int = iendIndex - 1;
					for (; start < end; start++, end--) {
						const startPart: FilePart = result[start];
						const endPart  : FilePart = result[end  ];
						if (!(startPart instanceof ChunkPart && startPart.typeStr == "dSIG" &&
								endPart instanceof ChunkPart && endPart.typeStr == "dSIG"))
							break;
						startPart.innerNotes.push("Introductory");
						endPart.innerNotes.push("Terminating");
						processedDsigs.add(startPart);
						processedDsigs.add(endPart);
					}
					for (; start < end; start++) {
						const part: FilePart = result[start];
						if (!(part instanceof ChunkPart && part.typeStr == "dSIG"))
							break;
						part.innerNotes.push("Introductory");
						part.errorNotes.push("Missing corresponding terminating dSIG chunk");
					}
					for (; start < end; end--) {
						const part: FilePart = result[start];
						if (!(part instanceof ChunkPart && part.typeStr == "dSIG"))
							break;
						part.innerNotes.push("Terminating");
						part.errorNotes.push("Missing corresponding introductory dSIG chunk");
					}
				}
				for (const part of result) {
					if (part instanceof ChunkPart && part.typeStr == "dSIG" && !processedDsigs.has(part))
						part.errorNotes.push("Chunk must be consecutively after IHDR chunk or consecutively before IEND chunk");
				}
			}
			
			let part = new UnknownPart(offset, new Uint8Array());
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
	
	abstract class FilePart {
		
		public outerNotes: Array<string|Node> = [];
		public innerNotes: Array<string|Node> = [];
		public errorNotes: Array<string|Node> = [];
		
		public constructor(
			public readonly offset: int,
			public readonly bytes: Uint8Array) {}
		
	}
	
	
	class SignaturePart extends FilePart {
		
		public constructor(
				offset: int,
				bytes: Uint8Array) {
			super(offset, bytes);
			
			this.outerNotes.push("Special: File signature");
			this.outerNotes.push(`Length: ${uintToStrWithThousandsSeparators(bytes.length)} bytes`);
			this.innerNotes.push(`\u201C${bytesToReadableString(bytes)}\u201D`);
			
			for (let i = 0; i < SignaturePart.FILE_SIGNATURE.length && this.errorNotes.length == 0; i++) {
				if (i >= bytes.length)
					this.errorNotes.push("Premature EOF");
				else if (bytes[i] != SignaturePart.FILE_SIGNATURE[i])
					this.errorNotes.push("Value mismatch");
			}
		}
		
		public static FILE_SIGNATURE: Array<byte> = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
		
	}
	
	
	class UnknownPart extends FilePart {
		
		public constructor(
				offset: int,
				bytes: Uint8Array) {
			super(offset, bytes);
			this.outerNotes.push("Special: Unknown");
			this.outerNotes.push(`Length: ${uintToStrWithThousandsSeparators(bytes.length)} bytes`);
		}
		
	}
	
	
	
	class ChunkPart extends FilePart {
		
		public typeStr: string = "";
		private isDataComplete: boolean = false;
		private data: Uint8Array = new Uint8Array();
		
		
		public constructor(
				offset: int,
				bytes: Uint8Array) {
			super(offset, bytes);
			
			if (bytes.length < 4) {
				this.outerNotes.push("Data length: Unfinished");
				this.errorNotes.push("Premature EOF");
				return;
			}
			
			const dataLen: int = readUint32(bytes, 0);
			this.outerNotes.push(`Data length: ${uintToStrWithThousandsSeparators(dataLen)} bytes`);
			if (dataLen > ChunkPart.MAX_DATA_LENGTH)
				this.errorNotes.push("Length out of range");
			else if (bytes.length < dataLen + 12)
				this.errorNotes.push("Premature EOF");
			
			if (bytes.length < 8) {
				this.outerNotes.push("Type: Unfinished");
				return;
			}
			
			{
				const typeBytes: Uint8Array = bytes.subarray(4, 8);
				this.typeStr = bytesToReadableString(typeBytes);
				this.outerNotes.push("Type: " + this.typeStr);
				const typeInfo = this.getTypeInfo();
				const typeName: string = typeInfo !== null ? typeInfo[0] : "Unknown";
				this.outerNotes.push("Name: " + typeName);
				this.outerNotes.push((typeBytes[0] & 0x20) == 0 ? "Critical (0)"       : "Ancillary (1)"   );
				this.outerNotes.push((typeBytes[1] & 0x20) == 0 ? "Public (0)"         : "Private (1)"     );
				this.outerNotes.push((typeBytes[2] & 0x20) == 0 ? "Reserved (0)"       : "Unknown (1)"     );
				this.outerNotes.push((typeBytes[3] & 0x20) == 0 ? "Unsafe to copy (0)" : "Safe to copy (1)");
			}
			
			if (dataLen > ChunkPart.MAX_DATA_LENGTH)
				return;
			
			if (bytes.length < dataLen + 12)
				this.outerNotes.push("CRC-32: Unfinished");
			else {
				const storedCrc: int = readUint32(bytes, bytes.length - 4);
				this.outerNotes.push(`CRC-32: ${storedCrc.toString(16).padStart(8,"0").toUpperCase()}`);
				const dataCrc: int = calcCrc32(bytes.subarray(4, bytes.length - 4));
				if (dataCrc != storedCrc)
					this.errorNotes.push(`CRC-32 mismatch (calculated from data: ${dataCrc.toString(16).padStart(8,"0").toUpperCase()})`);
			}
			
			this.isDataComplete = 8 + dataLen <= bytes.length;
			this.data = bytes.subarray(8, Math.min(8 + dataLen, bytes.length));
		}
		
		
		public annotate(earlierChunks: Array<ChunkPart>): void {
			if (this.innerNotes.length > 0)
				throw "Already annotated";
			if (!this.isDataComplete)
				return;
			const temp = this.getTypeInfo();
			if (temp !== null)
				temp[2](this, earlierChunks);
		}
		
		
		// The maximum length of a chunk's payload data, in bytes, inclusive.
		public static MAX_DATA_LENGTH: int = 0x7FFFFFFF;
		
		
		public getTypeInfo(): [string,boolean,((chunk:ChunkPart,earlier:Array<ChunkPart>)=>void)]|null {
			let result: [string,boolean,((chunk:ChunkPart,earlier:Array<ChunkPart>)=>void)]|null = null;
			for (const [type, name, multiple, func] of ChunkPart.TYPE_HANDLERS) {
				if (type == this.typeStr) {
					if (result !== null)
						throw "Table has duplicate keys";
					result = [name, multiple, func];
				}
			}
			return result;
		}
		
		
		
		/*---- Handlers and metadata for all known PNG chunk types ----*/
		
		private static TYPE_HANDLERS: Array<[string,string,boolean,((chunk:ChunkPart,earlier:Array<ChunkPart>)=>void)]> = [
			
			["bKGD", "Background color", false, function(chunk, earlier) {
				if (earlier.some(ch => ch.typeStr == "IDAT"))
					chunk.errorNotes.push("Chunk must be before IDAT chunk");
			}],
			
			
			["cHRM", "Primary chromaticities", false, function(chunk, earlier) {
				if (earlier.some(ch => ch.typeStr == "PLTE"))
					chunk.errorNotes.push("Chunk must be before PLTE chunk");
				if (earlier.some(ch => ch.typeStr == "IDAT"))
					chunk.errorNotes.push("Chunk must be before IDAT chunk");
				
				if (chunk.data.length != 32) {
					chunk.errorNotes.push("Invalid data length");
					return;
				}
				let offset: int = 0;
				for (const item of ["White point", "Red", "Green", "Blue"]) {
					for (const axis of ["x", "y"]) {
						const val: int = readUint32(chunk.data, offset);
						let s: string = val.toString().padStart(6, "0");
						s = s.substring(0, s.length - 5) + "." + s.substring(s.length - 5);
						// s basically equals (val/100000).toFixed(5)
						chunk.innerNotes.push(`${item} ${axis}: ${s}`);
						offset += 4;
					}
				}
			}],
			
			
			["dSIG", "Digital signature", true, function(chunk, earlier) {}],
			
			
			["eXIf", "Exchangeable Image File (Exif) Profile", false, function(chunk, earlier) {}],
			
			
			["fRAc", "Fractal image parameters", true, function(chunk, earlier) {}],
			
			
			["gAMA", "Image gamma", false, function(chunk, earlier) {
				if (earlier.some(ch => ch.typeStr == "PLTE"))
					chunk.errorNotes.push("Chunk must be before PLTE chunk");
				if (earlier.some(ch => ch.typeStr == "IDAT"))
					chunk.errorNotes.push("Chunk must be before IDAT chunk");
				
				if (chunk.data.length != 4) {
					chunk.errorNotes.push("Invalid data length");
					return;
				}
				const gamma: int = readUint32(chunk.data, 0);
				let s: string = gamma.toString().padStart(6, "0");
				s = s.substring(0, s.length - 5) + "." + s.substring(s.length - 5);
				// s basically equals (gamma/100000).toFixed(5)
				chunk.innerNotes.push(`Gamma: ${s}`);
			}],
			
			
			["gIFg", "GIF Graphic Control Extension", true, function(chunk, earlier) {
				if (chunk.data.length != 4) {
					chunk.errorNotes.push("Invalid data length");
					return;
				}
				const disposalMethod: byte = chunk.data[0];
				const userInputFlag : byte = chunk.data[1];
				const delayTime     : int = readUint16(chunk.data, 2);
				chunk.innerNotes.push(`Disposal method: ${disposalMethod}`);
				chunk.innerNotes.push(`User input flag: ${userInputFlag}`);
				let s: string = delayTime.toString().padStart(3, "0");
				s = s.substring(0, s.length - 2) + "." + s.substring(s.length - 2);
				// s basically equals (delayTime/100).toFixed(2)
				chunk.innerNotes.push(`Delay time: ${s} s`);
			}],
			
			
			["gIFt", "GIF Plain Text Extension", true, function(chunk, earlier) {
				if (chunk.data.length < 24) {
					chunk.errorNotes.push("Invalid data length");
					return;
				}
				const gridLeft  : int = readInt32(chunk.data,  0);
				const gridTop   : int = readInt32(chunk.data,  4);
				const gridWidth : int = readInt32(chunk.data,  8);
				const gridHeight: int = readInt32(chunk.data, 12);
				const cellWidth : byte = chunk.data[16];
				const cellHeight: byte = chunk.data[17];
				const foregroundColor: int = chunk.data[18] << 16 | chunk.data[19] << 8 | chunk.data[20] << 0;
				const backgroundColor: int = chunk.data[21] << 16 | chunk.data[22] << 8 | chunk.data[23] << 0;
				const text: string = bytesToReadableString(chunk.data.subarray(24));
				chunk.innerNotes.push(`Deprecated`);
				chunk.innerNotes.push(`Text grid left position: ${gridLeft}`);
				chunk.innerNotes.push(`Text grid top position: ${gridTop}`);
				chunk.innerNotes.push(`Text grid width: ${gridWidth}`);
				chunk.innerNotes.push(`Text grid height: ${gridHeight}`);
				chunk.innerNotes.push(`Character cell width: ${cellWidth}`);
				chunk.innerNotes.push(`Character cell height: ${cellHeight}`);
				chunk.innerNotes.push(`Text foreground color: #${foregroundColor.toString(16).padStart(2,"0")}`);
				chunk.innerNotes.push(`Text background color: #${backgroundColor.toString(16).padStart(2,"0")}`);
				chunk.innerNotes.push(`Plain text data: ${text}`);
			}],
			
			
			["gIFx", "GIF Application Extension", true, function(chunk, earlier) {
				if (chunk.data.length < 11) {
					chunk.errorNotes.push("Invalid data length");
					return;
				}
				chunk.innerNotes.push(`Application identifier: ${bytesToReadableString(chunk.data.subarray(0, 8))}`);
				{
					let hex: Array<string> = [];
					for (let i = 0; i < 3; i++)
						hex.push(chunk.data[8 + i].toString(16).padStart(2, "0"));
					chunk.innerNotes.push(`Authentication code: ${hex.join(" ")}`);
				}
				{
					let hex: Array<string> = [];
					for (const b of chunk.data.subarray(11))
						hex.push(b.toString(16).padStart(2, "0"));
					chunk.innerNotes.push(`Application data: ${hex.join(" ")}`);
				}
			}],
			
			
			["hIST", "Palette histogram", false, function(chunk, earlier) {
				if (earlier.some(ch => ch.typeStr == "IDAT"))
					chunk.errorNotes.push("Chunk must be before IDAT chunk");
				if (!earlier.some(ch => ch.typeStr == "PLTE"))
					chunk.errorNotes.push("Chunk requires earlier PLTE chunk");
				
				if (chunk.data.length % 2 != 0 || chunk.data.length / 2 > 256) {
					chunk.errorNotes.push("Invalid data length");
					return;
				}
			}],
			
			
			["iCCP", "Embedded ICC profile", false, function(chunk, earlier) {
				if (earlier.some(ch => ch.typeStr == "PLTE"))
					chunk.errorNotes.push("Chunk must be before PLTE chunk");
				if (earlier.some(ch => ch.typeStr == "IDAT"))
					chunk.errorNotes.push("Chunk must be before IDAT chunk");
				if (earlier.some(ch => ch.typeStr == "sRGB"))
					chunk.errorNotes.push("Chunk should not exist because sRGB chunk exists");
			}],
			
			
			["IDAT", "Image data", true, function(chunk, earlier) {
				if (earlier.length > 0 && earlier[earlier.length - 1].typeStr != "IDAT"
						&& earlier.some(ch => ch.typeStr == "IDAT")) {
					chunk.errorNotes.push("Non-consecutive IDAT chunk");
				}
			}],
			
			
			["IEND", "Image trailer", false, function(chunk, earlier) {
				if (chunk.data.length != 0)
					chunk.errorNotes.push("Non-empty data");
			}],
			
			
			["IHDR", "Image header", false, function(chunk, earlier) {
				if (chunk.data.length != 13) {
					chunk.errorNotes.push("Invalid data length");
					return;
				}
				const width    : int = readUint32(chunk.data, 0);
				const height   : int = readUint32(chunk.data, 4);
				const bitDepth : byte = chunk.data[ 8];
				const colorType: byte = chunk.data[ 9];
				const compMeth : byte = chunk.data[10];
				const filtMeth : byte = chunk.data[11];
				const laceMeth : byte = chunk.data[12];
				
				chunk.innerNotes.push(`Width: ${width} pixels`);
				if (width == 0 || width > 0x7FFFFFFF)
					chunk.errorNotes.push("Width out of range");
				
				chunk.innerNotes.push(`Height: ${height} pixels`);
				if (height == 0 || height > 0x7FFFFFFF)
					chunk.errorNotes.push("Height out of range");
				
				{
					let colorTypeStr: string;
					let validBitDepths: Array<int>;
					const temp: [string,Array<int>]|null = lookUpTable(colorType, [
						[0, ["Grayscale"      ,  [1, 2, 4, 8, 16]]],
						[2, ["RGB"            ,  [8, 16]         ]],
						[3, ["Palette"        ,  [1, 2, 4, 8]    ]],
						[4, ["Grayscale+Alpha",  [8, 16]         ]],
						[6, ["RGBA"           ,  [8, 16]         ]],
					]);
					colorTypeStr   = temp !== null ? temp[0] : "Unknown";
					validBitDepths = temp !== null ? temp[1] : []       ;
					chunk.innerNotes.push(`Bit depth: ${bitDepth} bits per ${colorType!=3?"channel":"pixel"}`);
					chunk.innerNotes.push(`Color type: ${colorTypeStr} (${colorType})`);
					if (temp === null)
						chunk.errorNotes.push("Unknown color type");
					else if (validBitDepths.indexOf(bitDepth) == -1)
						chunk.errorNotes.push("Invalid bit depth");
				}
				{
					let s: string|null = lookUpTable(compMeth, [
						[0, "DEFLATE"],
					]);
					if (s === null) {
						s = "Unknown";
						chunk.errorNotes.push("Unknown compression method");
					}
					chunk.innerNotes.push(`Compression method: ${s} (${compMeth})`);
				}
				{
					let s: string|null = lookUpTable(filtMeth, [
						[0, "Adaptive"],
					]);
					if (s === null) {
						s = "Unknown";
						chunk.errorNotes.push("Unknown filter method");
					}
					chunk.innerNotes.push(`Filter method: ${s} (${filtMeth})`);
				}
				{
					let s: string|null = lookUpTable(laceMeth, [
						[0, "None" ],
						[1, "Adam7"],
					]);
					if (s === null) {
						s = "Unknown";
						chunk.errorNotes.push("Unknown interlace method");
					}
					chunk.innerNotes.push(`Interlace method: ${s} (${laceMeth})`);
				}
			}],
			
			
			["iTXt", "International textual data", true, function(chunk, earlier) {
				let data: Array<byte> = [];
				for (const b of chunk.data)
					data.push(b);
				let dataIndex: int = 0;
				
				function parseNullTerminatedBytes(): [boolean,Array<byte>] {
					const nulIndex = data.indexOf(0, dataIndex);
					if (nulIndex == -1)
						return [false, data.slice(dataIndex)];
					else {
						const bytes: Array<byte> = data.slice(dataIndex, nulIndex);
						dataIndex = nulIndex + 1;
						return [true, bytes];
					}
				}
				
				let compFlag: byte|null = null;
				let compMeth: byte|null = null;
				loop:
				for (let state = 0; state < 6; state++) {
					switch (state) {
						case 0: {
							const [found, bytes] = parseNullTerminatedBytes();
							const keyword: string = decodeIso8859_1(bytes);
							annotateTextKeyword(keyword, chunk);
							if (!found) {
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
							let s: string|null = lookUpTable(compFlag, [
								[0, "Uncompressed"],
								[1, "Compressed"  ],
							]);
							if (s === null) {
								s = "Unknown";
								chunk.errorNotes.push("Unknown compression flag");
							}
							chunk.innerNotes.push(`Compression flag: ${s} (${compFlag})`);
							break;
						}
						
						case 2: {
							if (dataIndex == data.length) {
								chunk.errorNotes.push("Missing compression method");
								break loop;
							}
							compMeth = data[dataIndex];
							dataIndex++;
							let s: string|null = lookUpTable(compMeth, [
								[0, "DEFLATE"],
							]);
							if (s === null) {
								s = "Unknown";
								chunk.errorNotes.push("Unknown compression method");
							}
							chunk.innerNotes.push(`Compression method: ${s} (${compMeth})`);
							break;
						}
						
						case 3: {
							const [found, bytes] = parseNullTerminatedBytes();
							let langTag: string|null = null;
							try {
								langTag = decodeUtf8(bytes);
							} catch (e) {
								chunk.errorNotes.push("Invalid UTF-8 in language tag");
							}
							if (langTag !== null)
								chunk.innerNotes.push(`Language tag: ${langTag}`);
							if (!found) {
								chunk.errorNotes.push("Missing null separator");
								break loop;
							}
							break;
						}
						
						case 4: {
							const [found, bytes] = parseNullTerminatedBytes();
							let transKey: string|null = null;
							try {
								transKey = decodeUtf8(bytes);
							} catch (e) {
								chunk.errorNotes.push("Invalid UTF-8 in translated keyword");
							}
							if (transKey !== null)
								chunk.innerNotes.push(`Translated keyword: ${transKey}`);
							if (!found) {
								chunk.errorNotes.push("Missing null separator");
								break loop;
							}
							break;
						}
						
						case 5: {
							let textBytes: Array<byte> = data.slice(dataIndex);
							switch (compFlag) {
								case 0:  // Uncompressed
									break;
								case 1:
									if (compMeth == 0) {
										try {
											textBytes = deflate.decompressZlib(textBytes);
										} catch (e) {
											chunk.errorNotes.push("Text decompression error: " + e);
											break loop;
										}
									} else
										break loop;
									break;
								default:
									break loop;
							}
							let text: string;
							try {
								text = decodeUtf8(textBytes);
							} catch (e) {
								chunk.errorNotes.push("Invalid UTF-8 in text string");
								break;
							}
							let frag: DocumentFragment = document.createDocumentFragment();
							frag.appendChild(document.createTextNode("Text string: "));
							let span: HTMLElement = appendElem(frag, "span", text);
							span.style.wordBreak = "break-all";
							chunk.innerNotes.push(frag);
							break;
						}
						
						default:
							throw "Assertion error";
					}
				}
			}],
			
			
			["oFFs", "Image offset", false, function(chunk, earlier) {
				if (earlier.some(ch => ch.typeStr == "IDAT"))
					chunk.errorNotes.push("Chunk must be before IDAT chunk");
				
				if (chunk.data.length != 9) {
					chunk.errorNotes.push("Invalid data length");
					return;
				}
				const xPos: int = readInt32(chunk.data, 0);
				const yPos: int = readInt32(chunk.data, 4);
				const unit: byte = chunk.data[8];
				chunk.innerNotes.push(`X position: ${xPos.toString().replace(/-/,"\u2212")} units`);
				chunk.innerNotes.push(`Y position: ${yPos.toString().replace(/-/,"\u2212")} units`);
				{
					let s: string|null = lookUpTable(unit, [
						[0, "Pixel"     ],
						[1, "Micrometre"],
					]);
					if (s === null) {
						s = "Unknown";
						chunk.errorNotes.push("Unknown unit specifier");
					}
					chunk.innerNotes.push(`Unit specifier: ${s} (${unit})`);
				}
			}],
			
			
			["pCAL", "Calibration of pixel values", false, function(chunk, earlier) {
				if (earlier.some(ch => ch.typeStr == "IDAT"))
					chunk.errorNotes.push("Chunk must be before IDAT chunk");
			}],
			
			
			["pHYs", "Physical pixel dimensions", false, function(chunk, earlier) {
				if (earlier.some(ch => ch.typeStr == "IDAT"))
					chunk.errorNotes.push("Chunk must be before IDAT chunk");
				
				if (chunk.data.length != 9) {
					chunk.errorNotes.push("Invalid data length");
					return;
				}
				const horzRes: int = readUint32(chunk.data, 0);
				const vertRes: int = readUint32(chunk.data, 4);
				const unit   : byte = chunk.data[8];
				for (const [dir, val] of ([["Horizontal", horzRes], ["Vertical", vertRes]] as Array<[string,number]>)) {
					let frag: DocumentFragment = document.createDocumentFragment();
					frag.appendChild(document.createTextNode(`${dir} resolution: ${val} pixels per unit`));
					if (unit == 1) {
						frag.appendChild(document.createTextNode(` (\u2248 ${(val*0.0254).toFixed(0)} `));
						let abbr = appendElem(frag, "abbr", "DPI");
						abbr.title = "dots per inch";
						frag.appendChild(document.createTextNode(")"));
					}
					chunk.innerNotes.push(frag);
				}
				{
					let s: string|null = lookUpTable(unit, [
						[0, "Arbitrary (aspect ratio only)"],
						[1, "Metre"                        ],
					]);
					if (s === null) {
						s = "Unknown";
						chunk.errorNotes.push("Unknown unit specifier");
					}
					chunk.innerNotes.push(`Unit specifier: ${s} (${unit})`);
				}
			}],
			
			
			["PLTE", "Palette", false, function(chunk, earlier) {
				if (earlier.some(ch => ch.typeStr == "bKGD"))
					chunk.errorNotes.push("Chunk must be before bKGD chunk");
				if (earlier.some(ch => ch.typeStr == "hIST"))
					chunk.errorNotes.push("Chunk must be before hIST chunk");
				if (earlier.some(ch => ch.typeStr == "tRNS"))
					chunk.errorNotes.push("Chunk must be before tRNS chunk");
				if (earlier.some(ch => ch.typeStr == "IDAT"))
					chunk.errorNotes.push("Chunk must be before IDAT chunk");
			}],
			
			
			["sCAL", "Physical scale of image subject", false, function(chunk, earlier) {
				if (earlier.some(ch => ch.typeStr == "IDAT"))
					chunk.errorNotes.push("Chunk must be before IDAT chunk");
			}],
			
			
			["sBIT", "Significant bits", false, function(chunk, earlier) {
				if (earlier.some(ch => ch.typeStr == "PLTE"))
					chunk.errorNotes.push("Chunk must be before PLTE chunk");
				if (earlier.some(ch => ch.typeStr == "IDAT"))
					chunk.errorNotes.push("Chunk must be before IDAT chunk");
				
				if (chunk.data.length == 0 || chunk.data.length > 4)
					chunk.errorNotes.push("Invalid data length");
				let temp: Array<string> = [];
				for (const b of chunk.data)
					temp.push(b.toString());
				chunk.innerNotes.push(`Significant bits per channel: ${temp.join(", ")}`);
			}],
			
			
			["sPLT", "Suggested palette", true, function(chunk, earlier) {
				if (earlier.some(ch => ch.typeStr == "IDAT"))
					chunk.errorNotes.push("Chunk must be before IDAT chunk");
			}],
			
			
			["sRGB", "Standard RGB color space", false, function(chunk, earlier) {
				if (earlier.some(ch => ch.typeStr == "PLTE"))
					chunk.errorNotes.push("Chunk must be before PLTE chunk");
				if (earlier.some(ch => ch.typeStr == "IDAT"))
					chunk.errorNotes.push("Chunk must be before IDAT chunk");
				if (earlier.some(ch => ch.typeStr == "iCCP"))
					chunk.errorNotes.push("Chunk should not exist because iCCP chunk exists");
				
				if (chunk.data.length != 1) {
					chunk.errorNotes.push("Invalid data length");
					return;
				}
				const renderIntent: byte = chunk.data[0];
				let s: string|null = lookUpTable(renderIntent, [
					[0, "Perceptual"           ],
					[1, "Relative colorimetric"],
					[2, "Saturation"           ],
					[3, "Absolute colorimetric"],
				]);
				if (s === null) {
					s = "Unknown";
					chunk.errorNotes.push("Unknown rendering intent");
				}
				chunk.innerNotes.push(`Rendering intent: ${s} (${renderIntent})`);
			}],
			
			
			["sTER", "Indicator of Stereo Image", false, function(chunk, earlier) {
				if (earlier.some(ch => ch.typeStr == "IDAT"))
					chunk.errorNotes.push("Chunk must be before IDAT chunk");
				
				if (chunk.data.length != 1) {
					chunk.errorNotes.push("Invalid data length");
					return;
				}
				const mode: byte = chunk.data[0];
				let s: string|null = lookUpTable(mode, [
					[0, "Cross-fuse layout"    ],
					[1, "Diverging-fuse layout"],
				]);
				if (s === null) {
					s = "Unknown";
					chunk.errorNotes.push("Unknown mode");
				}
				chunk.innerNotes.push(`Mode: ${s} (${mode})`);
			}],
			
			
			["tEXt", "Textual data", true, function(chunk, earlier) {
				let data: Array<byte> = [];
				for (const b of chunk.data)
					data.push(b);
				
				const separatorIndex: int = data.indexOf(0);
				if (separatorIndex == -1) {
					chunk.errorNotes.push("Missing null separator");
					const keyword: string = decodeIso8859_1(data);
					annotateTextKeyword(keyword, chunk);
				} else {
					const keyword: string = decodeIso8859_1(data.slice(0, separatorIndex));
					annotateTextKeyword(keyword, chunk);
					const text: string = decodeIso8859_1(data.slice(separatorIndex + 1));
					chunk.innerNotes.push(`Text string: ${text}`);
					if (text.indexOf("\u0000") != -1)
						chunk.errorNotes.push("Null character in text string");
					if (text.indexOf("\uFFFD") != -1)
						chunk.errorNotes.push("Invalid ISO 8859-1 byte in text string");
				}
			}],
			
			
			["tIME", "Image last-modification time", false, function(chunk, earlier) {
				if (chunk.data.length != 7) {
					chunk.errorNotes.push("Invalid data length");
					return;
				}
				const year  : int = readUint16(chunk.data, 0);
				const month : byte = chunk.data[2];
				const day   : byte = chunk.data[3];
				const hour  : byte = chunk.data[4];
				const minute: byte = chunk.data[5];
				const second: byte = chunk.data[6];
				chunk.innerNotes.push(`Year: ${year}`);
				chunk.innerNotes.push(`Month: ${month}`);
				chunk.innerNotes.push(`Day: ${day}`);
				chunk.innerNotes.push(`Hour: ${hour}`);
				chunk.innerNotes.push(`Minute: ${minute}`);
				chunk.innerNotes.push(`Second: ${second}`);
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
			
			
			["tRNS", "Transparency", false, function(chunk, earlier) {
				if (earlier.some(ch => ch.typeStr == "IDAT"))
					chunk.errorNotes.push("Chunk must be before IDAT chunk");
			}],
			
			
			["zTXt", "Compressed textual data", true, function(chunk, earlier) {
				let data: Array<byte> = [];
				for (const b of chunk.data)
					data.push(b);
				
				const separatorIndex: int = data.indexOf(0);
				if (separatorIndex == -1) {
					chunk.errorNotes.push("Missing null separator");
					const keyword: string = decodeIso8859_1(data);
					annotateTextKeyword(keyword, chunk);
				} else {
					const keyword: string = decodeIso8859_1(data.slice(0, separatorIndex));
					annotateTextKeyword(keyword, chunk);
					if (separatorIndex + 1 >= data.length)
						chunk.errorNotes.push("Missing compression method");
					else {
						const compMeth: byte = data[separatorIndex + 1];
						let s: string|null = lookUpTable(compMeth, [
							[0, "DEFLATE"],
						]);
						if (s === null) {
							s = "Unknown";
							chunk.errorNotes.push("Unknown compression method");
						}
						chunk.innerNotes.push(`Compression method: ${s} (${compMeth})`);
						if (compMeth == 0) {
							try {
								const textBytes: Array<byte> = deflate.decompressZlib(data.slice(separatorIndex + 2));
								const text: string = decodeIso8859_1(textBytes);
								let frag: DocumentFragment = document.createDocumentFragment();
								frag.appendChild(document.createTextNode("Text string: "));
								let span: HTMLElement = appendElem(frag, "span", text);
								span.style.wordBreak = "break-all";
								chunk.innerNotes.push(frag);
								if (text.indexOf("\uFFFD") != -1)
									chunk.errorNotes.push("Invalid ISO 8859-1 byte in text string");
							} catch (e) {
								chunk.errorNotes.push("Text decompression error: " + e);
							}
						}
					}
				}
			}],
			
		];
		
	}
	
	
	
	/*---- Utility functions ----*/
	
	function annotateTextKeyword(keyword: string, chunk: ChunkPart): void {
		chunk.innerNotes.push(`Keyword: ${keyword}`);
		if (!(1 <= keyword.length && keyword.length <= 79))
			chunk.errorNotes.push("Invalid keyword length");
		for (let i = 0; i < keyword.length; i++) {
			const c: int = keyword.charCodeAt(i);
			if (0x20 <= c && c <= 0x7E || 0xA1 <= c && c <= 0xFF)
				continue;
			else {
				chunk.errorNotes.push("Invalid character in keyword");
				break;
			}
		}
		if (/^ |  | $/.test(keyword))
			chunk.errorNotes.push("Invalid space in keyword");
	}
	
	
	function calcCrc32(bytes: Uint8Array): int {
		let crc: int = ~0;
		for (const b of bytes) {
			for (let i = 0; i < 8; i++) {
				crc ^= (b >>> i) & 1;
				crc = (crc >>> 1) ^ (-(crc & 1) & 0xEDB88320);
			}
		}
		return ~crc >>> 0;
	}
	
	
	function bytesToReadableString(bytes: Uint8Array): string {
		let result: string = "";
		for (const b of bytes) {
			let cc: int = b;
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
	
	
	function decodeIso8859_1(bytes: Array<byte>): string {
		let result: string = "";
		for (const b of bytes) {
			if (!(0x00 <= b && b <= 0xFF))
				throw "Invalid byte";
			else if (0x80 <= b && b < 0xA0)
				result += "\uFFFD";
			else
				result += String.fromCharCode(b);  // ISO 8859-1 is a subset of Unicode
		}
		return result;
	}
	
	
	function decodeUtf8(bytes: Array<byte>): string {
		let temp: string = "";
		for (const b of bytes) {
			if (b == "%".charCodeAt(0) || b >= 128)
				temp += "%" + b.toString(16).padStart(2, "0");
			else
				temp += String.fromCharCode(b);
		}
		return decodeURI(temp);
	}
	
	
	function uintToStrWithThousandsSeparators(val: int): string {
		if (val < 0 || Math.floor(val) != val)
			throw "Invalid unsigned integer";
		let result: string = val.toString();
		for (let i = result.length - 3; i > 0; i -= 3)
			result = result.substring(0, i) + "\u00A0" + result.substring(i);
		return result;
	}
	
	
	function appendElem(container: Node, tagName: string, text?: string): HTMLElement {
		let result = document.createElement(tagName);
		container.appendChild(result);
		if (text !== undefined)
			result.textContent = text;
		return result;
	}
	
	
	function lookUpTable<V>(key: int, table: Array<[int,V]>): V|null {
		let result: V|null = null;
		for (const [k, v] of table) {
			if (k == key) {
				if (result !== null)
					throw "Table has duplicate keys";
				result = v;
			}
		}
		return result;
	}
	
	
	function readUint16(bytes: Uint8Array, offset: int): int {
		if (bytes.length - offset < 2)
			throw "Index out of range";
		return bytes[offset + 0] << 8
		     | bytes[offset + 1] << 0;
	}
	
	
	function readUint32(bytes: Uint8Array, offset: int): int {
		if (offset < 0 || bytes.length - offset < 4)
			throw "Index out of range";
		return (bytes[offset + 0] << 24
		      | bytes[offset + 1] << 16
		      | bytes[offset + 2] <<  8
		      | bytes[offset + 3] <<  0) >>> 0;
	}
	
	
	function readInt32(bytes: Uint8Array, offset: int): int {
		return readUint32(bytes, offset) | 0;
	}
	
	
	type Constructor<T> = { new(...args: Array<any>): T };
	
	function requireType<T>(val: unknown, type: Constructor<T>): T {
		if (val instanceof type)
			return val;
		else
			throw "Invalid value type";
	}
	
	
	
	/*---- Polyfills ----*/
	
	if (!("padStart" in String.prototype)) {
		String.prototype.padStart = function(len: int, padder: string): string {
			let result: string = this as string;
			while (result.length < len)
				result = padder.substring(0, Math.min(len - result.length, padder.length)) + result;
			return result;
		};
	}
	
}



namespace deflate {
	
	export function decompressZlib(bytes: Array<byte>): Array<byte> {
		if (bytes.length < 2)
			throw "Invalid zlib container";
		const compMeth: int = bytes[0] & 0xF;
		const compInfo: int = bytes[0] >>> 4;
		const presetDict: boolean = (bytes[1] & 0x20) != 0;
		const compLevel: int = bytes[1] >>> 6;
		
		if ((bytes[0] << 8 | bytes[1]) % 31 != 0)
			throw "zlib header checksum mismatch";
		if (compMeth != 8)
			throw `Unsupported compression method (${compMeth})`;
		if (compInfo > 7)
			throw `Unsupported compression info (${compInfo})`;
		if (presetDict)
			throw "Unsupported preset dictionary";
		
		const [result, input]: [Array<byte>,BitInputStream] = decompressDeflate(bytes.slice(2));
		let dataAdler: int;
		{
			let s1: int = 1;
			let s2: int = 0;
			for (const b of result) {
				s1 = (s1 + b) % 65521;
				s2 = (s2 + s1) % 65521;
			}
			dataAdler = s2 << 16 | s1;
		}
		
		let storedAdler: int = 0;
		input.readUint((8 - input.getBitPosition()) % 8);
		for (let i = 0; i < 4; i++)
			storedAdler = storedAdler << 8 | input.readUint(8);
		if (storedAdler != dataAdler)
			throw "Adler-32 mismatch";
		if (input.readBitMaybe() != -1)
			throw "Unexpected data after zlib container";
		return result;
	}
	
	
	export function decompressDeflate(bytes: Array<byte>): [Array<byte>,BitInputStream] {
		let input = new BitInputStream(bytes);
		let output: Array<byte> = [];
		let dictionary = new ByteHistory(32 * 1024);
		while (true) {
			const isFinal: boolean = input.readUint(1) != 0;
			const type: int = input.readUint(2);
			switch (type) {
				case 0:
					decompressUncompressedBlock();
					break;
				case 1:
					decompressHuffmanBlock(FIXED_LITERAL_LENGTH_CODE, FIXED_DISTANCE_CODE);
					break;
				case 2:
					const [litLenCode, distCode]: [CanonicalCode,CanonicalCode|null] = decodeHuffmanCodes();
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
		
		function decodeHuffmanCodes(): [CanonicalCode,CanonicalCode|null] {
			const numLitLenCodes: int = input.readUint(5) + 257;
			const numDistCodes: int = input.readUint(5) + 1;
			const numCodeLenCodes: int = input.readUint(4) + 4;
			let codeLenCodeLen: Array<int> = [];
			for (let i = 0; i < 19; i++)
				codeLenCodeLen.push(0);
			codeLenCodeLen[16] = input.readUint(3);
			codeLenCodeLen[17] = input.readUint(3);
			codeLenCodeLen[18] = input.readUint(3);
			codeLenCodeLen[ 0] = input.readUint(3);
			for (let i = 0; i < numCodeLenCodes - 4; i++) {
				const j: int = (i % 2 == 0) ? (8 + Math.floor(i / 2)) : (7 - Math.floor(i / 2));
				codeLenCodeLen[j] = input.readUint(3);
			}
			const codeLenCode = new CanonicalCode(codeLenCodeLen);
			let codeLens: Array<int> = [];
			while (codeLens.length < numLitLenCodes + numDistCodes) {
				const sym: int = codeLenCode.decodeNextSymbol(input);
				if (0 <= sym && sym <= 15)
					codeLens.push(sym);
				else if (sym == 16) {
					if (codeLens.length == 0)
						throw "No code length value to copy";
					const runLen: int = input.readUint(2) + 3;
					for (let i = 0; i < runLen; i++)
						codeLens.push(codeLens[codeLens.length - 1]);
				} else if (sym == 17) {
					const runLen: int = input.readUint(3) + 3;
					for (let i = 0; i < runLen; i++)
						codeLens.push(0);
				} else if (sym == 18) {
					const runLen: int = input.readUint(7) + 11;
					for (let i = 0; i < runLen; i++)
						codeLens.push(0);
				} else
					throw "Symbol out of range";
			}
			if (codeLens.length > numLitLenCodes + numDistCodes)
				throw "Run exceeds number of codes";
			const litLenCode = new CanonicalCode(codeLens.slice(0, numLitLenCodes));
			let distCodeLen: Array<int> = codeLens.slice(numLitLenCodes);
			let distCode: CanonicalCode|null;
			if (distCodeLen.length == 1 && distCodeLen[0] == 0)
				distCode = null;
			else {
				const oneCount: int = distCodeLen.filter(x => x == 1).length;
				const otherPositiveCount: int = distCodeLen.filter(x => x > 1).length;
				if (oneCount == 1 && otherPositiveCount == 0) {
					while (distCodeLen.length < 32)
						distCodeLen.push(0);
					distCodeLen[31] = 1;
				}
				distCode = new CanonicalCode(distCodeLen);
			}
			return [litLenCode, distCode];
		}
		
		function decompressUncompressedBlock(): void {
			input.readUint((8 - input.getBitPosition()) % 8);
			const len : int = input.readUint(16);
			const nlen: int = input.readUint(16);
			if ((len ^ 0xFFFF) != nlen)
				throw "Invalid length in uncompressed block";
			for (let i = 0; i < len; i++) {
				const b: byte = input.readUint(8);
				output.push(b);
				dictionary.append(b);
			}
		}
		
		function decompressHuffmanBlock(litLenCode: CanonicalCode, distCode: CanonicalCode|null): void {
			while (true) {
				const sym: int = litLenCode.decodeNextSymbol(input);
				if (sym == 256)
					break;
				else if (sym < 256) {
					output.push(sym);
					dictionary.append(sym);
				} else {
					const run: int = decodeRunLength(sym);
					if (!(3 <= run && run <= 258))
						throw "Invalid run length";
					if (distCode === null)
						throw "Length symbol encountered with empty distance code";
					const distSym: int = distCode.decodeNextSymbol(input);
					const dist: int = decodeDistance(distSym);
					if (!(1 <= dist && dist <= 32768))
						throw "Invalid distance";
					dictionary.copy(dist, run, output);
				}
			}
		}
		
		function decodeRunLength(sym: int): int {
			if (!(257 <= sym && sym <= 287))
				throw "Invalid run length symbol";
			if (sym <= 264)
				return sym - 254;
			else if (sym <= 284) {
				const numExtraBits: int = Math.floor((sym - 261) / 4);
				return (((sym - 265) % 4 + 4) << numExtraBits) + 3 + input.readUint(numExtraBits);
			} else if (sym == 285)
				return 258;
			else
				throw "Reserved length symbol";
		}
		
		function decodeDistance(sym: int): int {
			if (!(0 <= sym && sym <= 31))
				throw "Invalid distance symbol";
			if (sym <= 3)
				return sym + 1;
			else if (sym <= 29) {
				const numExtraBits: int = Math.floor(sym / 2) - 1;
				return ((sym % 2 + 2) << numExtraBits) + 1 + input.readUint(numExtraBits);
			} else
				throw "Reserved distance symbol";
		}
	}
	
	
	class CanonicalCode {
		
		private codeBitsToSymbol = new Map<int,int>();
		
		public constructor(codeLengths: Array<int>) {
			let nextCode: int = 0;
			for (let codeLength = 1; codeLength <= CanonicalCode.MAX_CODE_LENGTH; codeLength++) {
				nextCode <<= 1;
				const startBit: int = 1 << codeLength;
				codeLengths.forEach((cl, symbol) => {
					if (cl != codeLength)
						return;
					if (nextCode >= startBit)
						throw "This canonical code produces an over-full Huffman code tree";
					this.codeBitsToSymbol.set(startBit | nextCode, symbol);
					nextCode++;
				});
			}
			if (nextCode != 1 << CanonicalCode.MAX_CODE_LENGTH)
				throw "This canonical code produces an under-full Huffman code tree";
		}
		
		public decodeNextSymbol(inp: BitInputStream): int {
			let codeBits: int = 1;
			while (true) {
				codeBits = codeBits << 1 | inp.readUint(1);
				const result: int|undefined = this.codeBitsToSymbol.get(codeBits);
				if (result !== undefined)
					return result;
			}
		}
		
		private static readonly MAX_CODE_LENGTH: int = 15;
		
	}
	
	
	let FIXED_LITERAL_LENGTH_CODE: CanonicalCode;
	{
		let codeLens: Array<int> = [];
		for (let i = 0; i < 144; i++) codeLens.push(8);
		for (let i = 0; i < 112; i++) codeLens.push(9);
		for (let i = 0; i <  24; i++) codeLens.push(7);
		for (let i = 0; i <   8; i++) codeLens.push(8);
		FIXED_LITERAL_LENGTH_CODE = new CanonicalCode(codeLens);
	}
	
	let FIXED_DISTANCE_CODE: CanonicalCode;
	{
		let codeLens: Array<int> = [];
		for (let i = 0; i < 32; i++) codeLens.push(5);
		FIXED_DISTANCE_CODE = new CanonicalCode(codeLens);
	}
	
	
	class ByteHistory {
		
		public data: Uint8Array;
		public index: int = 0;
		
		public constructor(size: int) {
			if (size < 1)
				throw "Size must be positive";
			this.data = new Uint8Array(size);
		}
		
		public append(b: byte): void {
			if (!(0 <= this.index && this.index < this.data.length))
				throw "Assertion error";
			this.data[this.index] = b;
			this.index = (this.index + 1) % this.data.length;
		}
		
		public copy(dist: int, count: int, out: Array<byte>): void {
			if (count < 0 || !(1 <= dist && dist <= this.data.length))
				throw "Invalid argument";
			let readIndex: int = (this.index + this.data.length - dist) % this.data.length;
			for (let i = 0; i < count; i++) {
				const b: byte = this.data[readIndex];
				readIndex = (readIndex + 1) % this.data.length;
				out.push(b);
				this.append(b);
			}
		}
		
	}
	
	
	class BitInputStream {
		
		private bitIndex: int = 0;
		
		public constructor(
			private data: Array<byte>) {}
		
		public getBitPosition(): int {
			return this.bitIndex % 8;
		}
		
		public readBitMaybe(): -1|0|1 {
			const byteIndex: int = this.bitIndex >>> 3;
			if (byteIndex >= this.data.length)
				return -1;
			const result = ((this.data[byteIndex] >>> (this.bitIndex & 7)) & 1) as (0|1);
			this.bitIndex++;
			return result;
		}
		
		public readUint(numBits: int): int {
			if (numBits < 0)
				throw "Invalid argument";
			let result: int = 0;
			for (let i = 0; i < numBits; i++) {
				const bit: -1|0|1 = this.readBitMaybe();
				if (bit == -1)
					throw "Unexpected end of data";
				result |= bit << i;
			}
			return result;
		}
		
	}
	
}
