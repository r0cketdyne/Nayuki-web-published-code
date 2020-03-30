/* 
 * Time-based One-Time Password tools (TypeScript)
 * 
 * Copyright (c) 2020 Project Nayuki. (MIT License)
 * https://www.nayuki.io/page/time-based-one-time-password-tools
 * 
 * Permission is hereby granted, free of charge, to any person obtaining a copy of
 * this software and associated documentation files (the "Software"), to deal in
 * the Software without restriction, including without limitation the rights to
 * use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
 * the Software, and to permit persons to whom the Software is furnished to do so,
 * subject to the following conditions:
 * - The above copyright notice and this permission notice shall be included in
 *   all copies or substantial portions of the Software.
 * - The Software is provided "as is", without warranty of any kind, express or
 *   implied, including but not limited to the warranties of merchantability,
 *   fitness for a particular purpose and noninfringement. In no event shall the
 *   authors or copyright holders be liable for any claim, damages or other
 *   liability, whether in an action of contract, tort or otherwise, arising from,
 *   out of or in connection with the Software or the use or other dealings in the
 *   Software.
 */


type byte = number;



/*---- Main program ----*/

function main(): void {
	function getElement(id: string): HTMLElement {
		const result = document.getElementById(id);
		if (result instanceof HTMLElement)
			return result;
		throw "Assertion error";
	}
	
	function getInput(id: string): HTMLInputElement {
		const result = getElement(id);
		if (result instanceof HTMLInputElement)
			return result;
		throw "Assertion error";
	}
	
	if (getInput("current-time").checked)
		getInput("timestamp").value = Math.floor(Date.now() / 1000).toString();
	
	let outputElem = getElement("totp-code");
	try {
		outputElem.textContent = calcTotp(
			decodeBase32(getInput("secret-key").value),
			parseInt(getInput("epoch"      ).value, 10),
			parseInt(getInput("time-step"  ).value, 10),
			parseInt(getInput("timestamp"  ).value, 10),
			parseInt(getInput("code-length").value, 10));
	} catch (e) {
		outputElem.textContent = e.toString();
	}
}

if (selfCheck()) {
	main();
	setInterval(main, 1000);
}



/*---- Library functions ----*/

// Time-based One-Time Password algorithm (RFC 6238)
function calcTotp(
		secretKey: Array<byte>,
		epoch: number = 0,
		timeStep: number = 30,
		timestamp: number|null = null,
		codeLen: number = 6,
		hashFunc: ((msg:Array<byte>)=>Array<byte>) = calcSha1Hash,
		blockSize: number = 64,
		): string {
	
	if (timestamp === null)
		timestamp = Date.now();
	
	// Calculate counter and HOTP
	let timeCounter: number = Math.floor((timestamp - epoch) / timeStep);
	let counter: Array<byte> = [];
	for (let i = 0; i < 8; i++, timeCounter = Math.floor(timeCounter / 256))
		counter.push(timeCounter & 0xFF);
	counter.reverse();
	return calcHotp(secretKey, counter, codeLen, hashFunc, blockSize);
}


// HMAC-based One-Time Password algorithm (RFC 4226)
function calcHotp(
		secretKey: Array<byte>,
		counter: Array<byte>,
		codeLen: number = 6,
		hashFunc: ((msg:Array<byte>)=>Array<byte>) = calcSha1Hash,
		blockSize: number = 64,
		): string {
	
	// Check argument, calculate HMAC
	if (!(1 <= codeLen && codeLen <= 9))
		throw "Invalid number of digits";
	const hash: Array<byte> = calcHmac(secretKey, counter, hashFunc, blockSize);
	
	// Dynamically truncate the hash value
	const offset: number = hash[hash.length - 1] % 16;
	let val: number = 0;
	for (let i = 0; i < 4; i++)
		val |= hash[offset + i] << ((3 - i) * 8);
	val &= 0x7FFFFFFF;
	
	// Extract base-10 digits
	let tenPow: number = 1;
	for (let i = 0; i < codeLen; i++)
		tenPow *= 10;
	val %= tenPow;
	
	// Format base-10 digits
	let s: string = val.toString();
	while (s.length < codeLen)
		s = "0" + s;
	return s;
}


function calcHmac(
		key: Array<byte>,
		message: Array<byte>,
		hashFunc: ((msg:Array<byte>)=>Array<byte>),
		blockSize: number,
		): Array<byte> {
	
	if (blockSize < 1)
		throw "Invalid block size";
	if (key.length > blockSize)
		key = hashFunc(key);
	key = key.slice();
	while (key.length < blockSize)
		key.push(0x00);
	
	let innerMsg: Array<byte> = key.map(b => b ^ 0x36);
	for (const b of message)
		innerMsg.push(b);
	const innerHash: Array<byte> = hashFunc(innerMsg);
	
	let outerMsg: Array<byte> = key.map(b => b ^ 0x5C);
	for (const b of innerHash)
		outerMsg.push(b);
	return hashFunc(outerMsg);
}



function calcSha1Hash(message: Array<byte>): Array<byte> {
	let bitLenBytes: Array<byte> = [];
	for (let i = 0, bitLen = message.length * 8; i < 8; i++, bitLen >>>= 8)
		bitLenBytes.push(bitLen & 0xFF);
	bitLenBytes.reverse();
	
	message = message.slice();
	message.push(0x80);
	while ((message.length + 8) % 64 != 0)
		message.push(0x00);
	for (const b of bitLenBytes)
		message.push(b);
	
	let state: Array<number> = [0x67452301, 0xEFCDAB89, 0x98BADCFE, 0x10325476, 0xC3D2E1F0];
	for (let i = 0; i < message.length; i += 64) {
		let schedule: Array<number> = [];
		for (let j = 0; j < 64; j++) {
			if (j % 4 == 0)
				schedule.push(0);
			schedule[Math.floor(j / 4)] |= message[i + j] << ((3 - j % 4) * 8);
		}
		for (let j = schedule.length; j < 80; j++) {
			const temp: number = schedule[j - 3] ^ schedule[j - 8] ^ schedule[j - 14] ^ schedule[j - 16];
			schedule.push((temp << 1) | (temp >>> 31));
		}
		let [a, b, c, d, e] = state;
		schedule.forEach((sch, j) => {
			let f: number, rc: number;
			switch (Math.floor(j / 20)) {
				case 0:  f = (b & c) | (~b & d);           rc = 0x5A827999;  break;
				case 1:  f = b ^ c ^ d;                    rc = 0x6ED9EBA1;  break;
				case 2:  f = (b & c) ^ (b & d) ^ (c & d);  rc = 0x8F1BBCDC;  break;
				case 3:  f = b ^ c ^ d;                    rc = 0xCA62C1D6;  break;
				default:  throw "Assertion error";
			}
			const temp = (((a << 5) | (a >>> 27)) + f + e + sch + rc) >>> 0;
			e = d;
			d = c;
			c = (b << 30) | (b >>> 2);
			b = a;
			a = temp;
		});
		state[0] = (state[0] + a) >>> 0;
		state[1] = (state[1] + b) >>> 0;
		state[2] = (state[2] + c) >>> 0;
		state[3] = (state[3] + d) >>> 0;
		state[4] = (state[4] + e) >>> 0;
	}
	
	let result: Array<byte> = [];
	for (const val of state) {
		for (let i = 3; i >= 0; i--)
			result.push((val >>> (i * 8)) & 0xFF);
	}
	return result;
}


function decodeBase32(str: string): Array<byte> {
	const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
	let result: Array<byte> = [];
	let bits: number = 0;
	let bitsLen: number = 0;
	for (const c of str) {
		if (c == " ")
			continue;
		const i: number = ALPHABET.indexOf(c.toUpperCase());
		if (i == -1)
			throw "Invalid Base32 string";
		bits = (bits << 5) | i;
		bitsLen += 5;
		if (bitsLen >= 8) {
			bitsLen -= 8;
			result.push(bits >>> bitsLen);
			bits &= (1 << bitsLen) - 1;
		}
	}
	return result;
}



/*---- Test suite ----*/

function selfCheck(): boolean {
	try {
		testHotp();
		testTotp();
		return true;
	} catch (e) {
		alert("Self-check failed: " + e);
		return false;
	}
}


function testHotp(): void {
	const CASES: Array<[number,string]> = [
		[0, "284755224"],
		[1, "094287082"],
		[2, "137359152"],
		[3, "726969429"],
		[4, "640338314"],
		[5, "868254676"],
		[6, "918287922"],
		[7, "082162583"],
		[8, "673399871"],
		[9, "645520489"],
	];
	const SECRET_KEY: Array<byte> = [0x31,0x32,0x33,0x34,0x35,0x36,0x37,0x38,0x39,0x30,0x31,0x32,0x33,0x34,0x35,0x36,0x37,0x38,0x39,0x30];
	
	for (let [counter, expect] of CASES) {
		let counterBytes: Array<byte> = [];
		for (let i = 0; i < 8; i++, counter = Math.floor(counter / 256))
			counterBytes.push(counter & 0xFF);
		counterBytes.reverse();
		const actual: string = calcHotp(SECRET_KEY, counterBytes, 9);
		if (actual != expect)
			throw "Value mismatch";
	}
}


function testTotp(): void {
	const CASES: Array<[number,string]> = [
		[         59, "94287082"],
		[ 1111111109, "07081804"],
		[ 1111111111, "14050471"],
		[ 1234567890, "89005924"],
		[ 2000000000, "69279037"],
		[20000000000, "65353130"],
	];
	const SECRET_KEY: Array<byte> = [0x31,0x32,0x33,0x34,0x35,0x36,0x37,0x38,0x39,0x30,0x31,0x32,0x33,0x34,0x35,0x36,0x37,0x38,0x39,0x30];
	
	for (const [timestamp, expect] of CASES) {
		const actual: string = calcTotp(SECRET_KEY, 0, 30, timestamp, 8);
		if (actual != expect)
			throw "Value mismatch";
	}
}
