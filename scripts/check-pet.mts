// node --experimental-transform-types scripts/check-pet.mts  -> asserts pet levelling and unlock rules
import assert from 'node:assert/strict'
import { isUnlocked, levelOf } from '../src/shared/pet.ts'

assert.deepEqual(levelOf(0), { level: 0, into: 0, need: 100 })
assert.deepEqual(levelOf(99), { level: 0, into: 99, need: 100 })
assert.deepEqual(levelOf(100), { level: 1, into: 0, need: 150 })
assert.deepEqual(levelOf(250), { level: 2, into: 0, need: 200 })
assert.equal(isUnlocked('head:beanie', 0), true)
assert.equal(isUnlocked('head:crown', 4), false)
assert.equal(isUnlocked('head:crown', 5), true)
assert.equal(isUnlocked('head:witch', 0, new Date(2026, 9, 15)), true) // free in October
assert.equal(isUnlocked('head:witch', 0, new Date(2026, 5, 15)), false)
console.log('pet checks passed')
