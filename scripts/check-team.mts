// node --experimental-transform-types scripts/check-team.mts  -> asserts team scheduling and folder validation
import assert from 'node:assert/strict'
import { freeSlots, icsEvent, validMember, validMessage, validStandup } from '../src/shared/team.ts'

const H = 3600_000
// Monday 2026-10-19 00:00 UTC
const mon = Date.UTC(2026, 9, 19)
const tokyo = { tzOffset: -540, work: { start: 9, end: 18 }, busy: [] as { s: number; e: number }[] }
const london = { tzOffset: -60, work: { start: 9, end: 17 }, busy: [] as { s: number; e: number }[] }

// Tokyo 9-18 = 00:00-09:00 UTC; London (BST) 9-17 = 08:00-16:00 UTC -> overlap 08:00-09:00 UTC
const s1 = freeSlots([tokyo, london], 30, mon - H)
assert.ok(s1.length >= 1)
assert.equal(new Date(s1[0].s).toISOString(), '2026-10-19T08:00:00.000Z')
// a busy block over the overlap pushes the slot to the next weekday
const s2 = freeSlots([{ ...tokyo, busy: [{ s: mon + 8 * H, e: mon + 9 * H }] }, london], 30, mon - H)
assert.equal(new Date(s2[0].s).toISOString(), '2026-10-20T08:00:00.000Z')
// weekends are skipped: Saturday morning -> Monday
const sat = Date.UTC(2026, 9, 24)
assert.equal(new Date(freeSlots([london], 60, sat)[0].s).getUTCDay(), 1)
// options are spread out
const s3 = freeSlots([london], 30, mon - H)
assert.ok(s3[1].s - s3[0].s >= 90 * 60_000)

// validation: path tricks and bad shapes are rejected
const pet = { name: 'Pip', species: 'blob', color: '#4285F4', accent: '#FFFFFF' }
const member = { id: 'abcdefabcdef12', name: 'Sam', pet, tzOffset: -60, work: { start: 9, end: 17 }, busy: [{ s: 1, e: 2 }], updatedAt: 1 }
assert.ok(validMember(member))
assert.equal(validMember({ ...member, id: '../../evil' }), null)
assert.equal(validMember({ ...member, pet: { ...pet, color: 'red; background:url(x)' } }), null)
assert.equal(validMessage({ id: 'm1', from: 'abcdefabcdef12', to: 'me', at: 1, type: 'wave' }, 'other'), null) // not for me
assert.ok(validMessage({ id: 'm1', from: 'abcdefabcdef12', to: 'me1234567890ab', at: 1, type: 'meet.ask', title: 'Sync', minutes: 30, start: 5 }, 'me1234567890ab'))
assert.equal(validMessage({ id: 'm1', from: 'abcdefabcdef12', to: 'me1234567890ab', at: 1, type: 'meet.ask', title: 'Sync', minutes: 9999, start: 5 }, 'me1234567890ab'), null)
assert.equal(validMessage({ id: 'm1', from: 'abcdefabcdef12', to: 'me1234567890ab', at: 1, type: 'run', cmd: 'calc.exe' }, 'me1234567890ab'), null)
assert.ok(validStandup({ memberId: 'abcdefabcdef12', name: 'Sam', date: '2026-10-21', done: ['QA plan'], today: [], at: 1 }))
assert.equal(validStandup({ memberId: 'abcdefabcdef12', name: 'Sam', date: '../x', done: [], today: [], at: 1 }), null)

// .ics escapes text and lists attendees
const ics = icsEvent({ uid: 'u1', title: 'Plan; Q4, launch', start: mon + 8 * H, minutes: 30, attendees: ['sam@example.com'] })
assert.ok(ics.includes('SUMMARY:Plan\\; Q4\\, launch'))
assert.ok(ics.includes('DTSTART:20261019T080000Z') && ics.includes('DTEND:20261019T083000Z'))
assert.ok(ics.includes('ATTENDEE;RSVP=TRUE:mailto:sam@example.com'))
console.log('team checks passed')
