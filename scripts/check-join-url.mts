// node --experimental-transform-types scripts/check-join-url.mts  -> asserts calendar join-link detection
import assert from 'node:assert/strict'
import { joinUrlOf } from '../src/shared/google.ts'

assert.equal(joinUrlOf({ hangoutLink: 'https://meet.google.com/abc-defg-hij' }), 'https://meet.google.com/abc-defg-hij')
assert.equal(
  joinUrlOf({ hangoutLink: 'https://meet.google.com/x', conferenceData: { entryPoints: [{ entryPointType: 'phone', uri: 'tel:+1' }, { entryPointType: 'video', uri: 'https://meet.google.com/y' }] } }),
  'https://meet.google.com/y'
)
assert.equal(joinUrlOf({ location: 'Zoom https://us02web.zoom.us/j/8123456789?pwd=abc' }), 'https://us02web.zoom.us/j/8123456789?pwd=abc')
assert.equal(
  joinUrlOf({ description: '<a href="https://teams.microsoft.com/l/meetup-join/19%3ameeting_x%40thread.v2/0?context=%7b%7d&amp;a=1">Join</a>' }),
  'https://teams.microsoft.com/l/meetup-join/19%3ameeting_x%40thread.v2/0?context=%7b%7d&a=1'
)
assert.equal(joinUrlOf({ location: 'Room 4B', description: 'See https://example.com/agenda' }), undefined)
console.log('join-url checks passed')
