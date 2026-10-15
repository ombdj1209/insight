// node --experimental-transform-types scripts/check-i18n.mts  -> asserts language resolution and call-app detection
import assert from 'node:assert/strict'
import { findWorld, worldFromLocale, writtenFor } from '../src/shared/languages.ts'
import { callAppName } from '../src/shared/calls.ts'

assert.equal(worldFromLocale('ja-JP').name, 'Japanese')
assert.equal(worldFromLocale('zh-TW').name, 'Chinese (Traditional)')
assert.equal(worldFromLocale('zh-CN').name, 'Chinese (Simplified)')
assert.equal(worldFromLocale('nb-NO').name, 'Norwegian')
assert.equal(worldFromLocale('ar-SA').name, 'Arabic')
assert.equal(findWorld('Arabic')?.rtl, true)
assert.equal(worldFromLocale('xx-YY').name, 'English') // unknown falls back
assert.equal(writtenFor('Cantonese'), 'Chinese (Simplified)')
assert.equal(writtenFor('Japanese + English'), 'English')
assert.equal(writtenFor('German'), 'German')

const key = (exe: string): string => `C:#Program Files#${exe}`
assert.equal(callAppName(key('Zoom#bin#Zoom.exe')), 'Zoom')
assert.equal(callAppName('MSTeams_8wekyb3d8bbwe'), 'Microsoft Teams')
assert.equal(callAppName(key('Google#Chrome#Application#chrome.exe')), 'your browser')
assert.equal(callAppName(key('Insight#Insight.exe')), null)
assert.equal(callAppName(key('Audacity#audacity.exe')), null)
console.log('i18n checks passed')
