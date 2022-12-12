/*
 * Disjoint-set data structure - Test suite (compiled from TypeScript)
 *
 * Copyright (c) 2022 Project Nayuki. (MIT License)
 * https://www.nayuki.io/page/disjoint-set-data-structure
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
"use strict";
importScripts("DisjointSet.js");
/*---- Main runner ----*/
function main() {
    for (const func of TEST_SUITE) {
        let msg = func.name + "(): ";
        try {
            func();
            msg += "Pass";
        }
        catch (e) {
            msg += "Fail - " + e.message;
        }
        postMessage(msg);
    }
    postMessage("Finished");
}
setTimeout(main);
/*---- Test suite ----*/
const TEST_SUITE = [
    function testNew() {
        let ds = new DisjointSet(10);
        assertEquals(10, ds.getNumSets());
        assertEquals(1, ds.getSizeOfSet(0));
        assertEquals(1, ds.getSizeOfSet(2));
        assertEquals(1, ds.getSizeOfSet(9));
        assertTrue(ds.areInSameSet(0, 0));
        assertFalse(ds.areInSameSet(0, 1));
        assertFalse(ds.areInSameSet(9, 3));
        ds.checkStructure();
    },
    function testMerge() {
        let ds = new DisjointSet(10);
        assertTrue(ds.mergeSets(0, 1));
        ds.checkStructure();
        assertEquals(9, ds.getNumSets());
        assertTrue(ds.areInSameSet(0, 1));
        assertTrue(ds.mergeSets(2, 3));
        ds.checkStructure();
        assertEquals(8, ds.getNumSets());
        assertTrue(ds.areInSameSet(2, 3));
        assertFalse(ds.mergeSets(2, 3));
        ds.checkStructure();
        assertEquals(8, ds.getNumSets());
        assertFalse(ds.areInSameSet(0, 2));
        assertTrue(ds.mergeSets(0, 3));
        ds.checkStructure();
        assertEquals(7, ds.getNumSets());
        assertTrue(ds.areInSameSet(0, 2));
        assertTrue(ds.areInSameSet(3, 0));
        assertTrue(ds.areInSameSet(1, 3));
    },
    function testBigMerge() {
        const maxRank = 20;
        const trials = 10000;
        const numElems = 1 << maxRank; // Grows exponentially
        let ds = new DisjointSet(numElems);
        for (let level = 0; level < maxRank; level++) {
            const mergeStep = 1 << level;
            const incrStep = mergeStep * 2;
            for (let i = 0; i < numElems; i += incrStep) {
                assertFalse(ds.areInSameSet(i, i + mergeStep));
                assertTrue(ds.mergeSets(i, i + mergeStep));
            }
            // Now we have a bunch of sets of size 2^(level+1)
            // Do random tests
            const mask = -incrStep; // 0b11...100...00
            for (let i = 0; i < trials; i++) {
                const j = Math.floor(Math.random() * numElems);
                const k = Math.floor(Math.random() * numElems);
                const expect = (j & mask) == (k & mask);
                assertTrue(expect == ds.areInSameSet(j, k));
            }
        }
    },
    function testAgainstNaiveRandomly() {
        const trials = 100;
        const iterations = 1000;
        const numElems = 100;
        for (let i = 0; i < trials; i++) {
            let nds = new NaiveDisjointSet(numElems);
            let ds = new DisjointSet(numElems);
            for (let j = 0; j < iterations; j++) {
                const k = Math.floor(Math.random() * numElems);
                const l = Math.floor(Math.random() * numElems);
                assertEquals(nds.getSizeOfSet(k), ds.getSizeOfSet(k));
                assertTrue(nds.areInSameSet(k, l) == ds.areInSameSet(k, l));
                if (Math.random() < 0.1)
                    assertTrue(nds.mergeSets(k, l) == ds.mergeSets(k, l));
                assertEquals(nds.getNumSets(), ds.getNumSets());
                if (Math.random() < 0.001)
                    ds.checkStructure();
            }
            ds.checkStructure();
        }
    },
];
/*---- Helper definitions ----*/
class NaiveDisjointSet {
    constructor(numElems) {
        this.representatives = [];
        for (let i = 0; i < numElems; i++)
            this.representatives.push(i);
    }
    getNumSets() {
        let result = 0;
        this.representatives.forEach((repr, i) => {
            if (repr == i)
                result++;
        });
        return result;
    }
    getSizeOfSet(elemIndex) {
        const repr = this.representatives[elemIndex];
        let result = 0;
        for (const r of this.representatives) {
            if (r == repr)
                result++;
        }
        return result;
    }
    areInSameSet(elemIndex0, elemIndex1) {
        return this.representatives[elemIndex0] == this.representatives[elemIndex1];
    }
    mergeSets(elemIndex0, elemIndex1) {
        const repr0 = this.representatives[elemIndex0];
        const repr1 = this.representatives[elemIndex1];
        this.representatives.forEach((r, i) => {
            if (r == repr1)
                this.representatives[i] = repr0;
        });
        return repr0 != repr1;
    }
}
function assertTrue(cond) {
    if (cond !== true)
        throw new Error("Assertion error");
}
function assertFalse(cond) {
    assertTrue(cond === false);
}
function assertEquals(expect, actual) {
    assertTrue(actual === expect);
}
