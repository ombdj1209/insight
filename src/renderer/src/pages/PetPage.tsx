import { t as tr } from '../i18n'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Box, Button, ButtonBase, LinearProgress, MenuItem, Select, Slider, Switch, TextField, Tooltip, Typography } from '@mui/material'
import LockRounded from '@mui/icons-material/LockRounded'
import {
  BADGES, badgeFor, DEFAULT_PET, DEFAULT_PROGRESS, isUnlocked, levelOf, PALETTE, seasonal, SPECIES, unlockLevel,
  type Eyes, type FaceItem, type HeadItem, type Mood, type NeckItem, type Pattern, type PetConfig, type PetProgress, type SoundPack, type Species
} from '../../../shared/pet'
import type { AppCtx } from '../App'
import { api, useEvent } from '../api'
import { Segmented } from '../components/ui'
import { MOOD_SHAPE, PetSvg, type Pose } from '../pet/PetSvg'
import { play } from '../pet/sound'
import { Row, Section } from './Settings'
import { WORLD } from '../../../shared/languages'

/** Animated pose for previews (same look as the desktop pet, without the physics). */
function usePose(mood: Mood): Pose {
  const [, tick] = useState(0)
  const s = useRef({ shape: { from: MOOD_SHAPE[mood], to: MOOD_SHAPE[mood], start: 0 }, mood, nextBlink: 0, blinkUntil: 0 }).current
  useEffect(() => {
    let raf = 0
    const loop = (): void => {
      tick((n) => (n + 1) % 1e9)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [])
  const now = performance.now()
  if (s.mood !== mood) {
    s.shape = { from: s.shape.to, to: MOOD_SHAPE[mood], start: now }
    s.mood = mood
  }
  if (now > s.nextBlink) {
    s.blinkUntil = now + 130
    s.nextBlink = now + 2500 + Math.random() * 3000
  }
  const m = Math.min(1, (now - s.shape.start) / 320)
  return {
    t: now,
    mood,
    look: { x: Math.sin(now / 1700) * 0.6, y: Math.sin(now / 2300) * 0.3 },
    blink: now < s.blinkUntil,
    squash: 0,
    lean: 0,
    walkPhase: mood === 'walking' ? now / 70 : 0,
    shape: { from: s.shape.from, to: s.shape.to, m: 0.5 - Math.cos(m * Math.PI) / 2 }
  }
}

const MOODS: [Mood, string][] = [
  ['idle', 'Idle'],
  ['happy', 'Happy'],
  ['excited', 'Excited'],
  ['listening', 'In a meeting'],
  ['writing', 'Writing notes'],
  ['sleepy', 'Sleepy'],
  ['dance', 'Party'],
  ['stressed', 'Busy day']
]

function Chip({ on, label, locked, lockLv, lockBadge, onClick, children }: { on: boolean; label: string; locked?: boolean; lockLv?: number; lockBadge?: string; onClick: () => void; children?: ReactNode }) {
  return (
    <Tooltip title={locked ? (lockBadge ? tr("Earn the \"{lockBadge}\" badge to unlock", { lockBadge }) : tr("Unlocks at level {lockLv}", { lockLv: lockLv ?? 0 })) : ''}>
      <span>
        <ButtonBase
          disabled={locked}
          onClick={onClick}
          sx={(t) => ({
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 0.5,
            px: 1.5,
            py: 1,
            minWidth: 76,
            borderRadius: 3,
            border: `2px solid ${on ? t.fs.primary : 'transparent'}`,
            bgcolor: on ? t.fs.secondaryContainer : t.fs.sheet,
            opacity: locked ? 0.45 : 1,
            fontSize: 13,
            fontWeight: 600
          })}
        >
          {children}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            {locked && <LockRounded sx={{ fontSize: 14 }} />}
            {label}
          </Box>
        </ButtonBase>
      </span>
    </Tooltip>
  )
}

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)

export function PetPage({ ctx }: { ctx: AppCtx }) {
  const [c, setC] = useState<PetConfig>(DEFAULT_PET)
  const [p, setP] = useState<PetProgress>(DEFAULT_PROGRESS)
  const [mood, setMood] = useState<Mood>('idle')
  useEffect(() => {
    void api.petGet().then((r) => {
      setC(r.config)
      setP(r.progress)
    })
  }, [])
  useEvent('pet:config', setC)
  useEvent('pet:progress', setP)
  const set = (patch: Partial<PetConfig>): void => {
    setC((x) => ({ ...x, ...patch, topics: { ...x.topics, ...patch.topics } }))
    void api.petSet(patch)
  }
  const pose = usePose(mood)
  const lv = levelOf(p.xp)
  const avail = (slot: string, v: string): boolean => v === 'none' || isUnlocked(`${slot}:${v}`, lv.level, new Date(), p.badges ?? [])

  const items = <T extends string>(slot: 'head' | 'face' | 'neck' | 'eyes' | 'pattern', values: T[], value: T, onPick: (v: T) => void) => (
    <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', justifyContent: 'flex-end', maxWidth: 560 }}>
      {values.map((v) => {
        const id = `${slot}:${v}`
        const locked = !avail(slot, v)
        return (
          <Chip key={v} on={value === v} label={v === 'none' ? tr("None") : tr(cap(v)) + (seasonal(id) ? ' ✨' : '')} locked={locked} lockLv={unlockLevel(id)} lockBadge={tr(BADGES.find((b) => b.id === badgeFor(id))?.label ?? '')} onClick={() => onPick(v)}>
            <PetSvg c={{ ...c, [slot]: v }} p={{ ...pose, mood: 'idle', look: { x: 0, y: 0 } }} size={54} />
          </Chip>
        )
      })}
    </Box>
  )
  const swatches = (value: string, onPick: (v: string) => void) => (
    <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', justifyContent: 'flex-end', alignItems: 'center', maxWidth: 420 }}>
      {PALETTE.map((col) => (
        <ButtonBase key={col} onClick={() => onPick(col)} aria-label={col} sx={{ width: 28, height: 28, borderRadius: '50%', bgcolor: col, outline: value.toLowerCase() === col.toLowerCase() ? '3px solid #0B57D0' : '1px solid rgba(0,0,0,.15)', outlineOffset: 2 }} />
      ))}
      <Box component="input" type="color" value={value} onChange={(e) => onPick((e.target as HTMLInputElement).value)} sx={{ width: 34, height: 30, border: 0, p: 0, bgcolor: 'transparent', cursor: 'pointer' }} />
    </Box>
  )
  const hours = Array.from({ length: 24 }, (_, h) => [String(h), `${String(h).padStart(2, '0')}:00`] as [string, string])

  return (
    <Box sx={{ height: '100%', overflowY: 'auto' }}>
      <Box sx={{ maxWidth: 1160, mx: 'auto', px: { xs: 3, md: 5 }, pt: 5, pb: 10, display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '360px 1fr' }, gap: 4, alignItems: 'start' }}>
        {/* preview */}
        <Box sx={(t) => ({ position: { lg: 'sticky' }, top: 24, p: 3, borderRadius: 7, bgcolor: t.fs.container })}>
          <Typography variant="h4" component="h1">
            {c.name || tr("Your pet")}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {tr("Lives on your desktop, reminds you about meetings, and keeps you company.")}
          </Typography>
          <Box sx={(t) => ({ mt: 2, height: 280, borderRadius: 5, bgcolor: t.fs.sheet, display: 'grid', placeItems: 'center' })}>
            <PetSvg c={c} p={pose} size={Math.round(220 * Math.min(1.15, c.size))} />
          </Box>
          <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', mt: 1.5 }}>
            {MOODS.map(([m, l]) => (
              <Button key={m} size="small" variant={mood === m ? 'contained' : 'outlined'} onClick={() => setMood(m)} sx={{ borderRadius: 99, minWidth: 0 }}>
                {tr(l)}
              </Button>
            ))}
          </Box>
          <Box sx={{ mt: 2.5 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
              <Typography variant="subtitle2">{tr("Level")}{' '}{lv.level}</Typography>
              <Typography variant="caption" color="text.secondary">
                {lv.into} / {lv.need}{' '}{tr("XP")}
              </Typography>
            </Box>
            <LinearProgress variant="determinate" value={(lv.into / lv.need) * 100} sx={{ height: 8, borderRadius: 4, mt: 0.5 }} />
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75 }}>
              {tr("Earn XP from meetings, notes, petting and feeding files.")}{' '}{p.meetings}{' '}{tr("meetings together · petted")}{' '}{p.pets}{' '}{tr("times.")}
            </Typography>
          </Box>
          <Box sx={{ mt: 2 }}>
            <Typography variant="subtitle2" sx={{ mb: 0.75 }}>
              {tr("Badges")}
            </Typography>
            <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
              {BADGES.map((b) => {
                const got = (p.badges ?? []).includes(b.id)
                return (
                  <Tooltip key={b.id} title={`${tr(b.desc)}${b.reward ? ` · ${tr('unlocks the {item}', { item: tr(cap(b.reward.split(':')[1])) })}` : ''}`}>
                    <Box sx={(t) => ({ px: 1.25, py: 0.5, borderRadius: 99, fontSize: 12, fontWeight: 700, bgcolor: got ? t.fs.tertiaryContainer : t.fs.sheet, color: got ? t.fs.onTertiaryContainer : 'text.disabled', border: got ? 'none' : `1px dashed ${t.fs.outlineVariant}` })}>
                      {got ? '🏅 ' : ''}
                      {tr(b.label)}
                    </Box>
                  </Tooltip>
                )
              })}
            </Box>
          </Box>
          <Box sx={{ display: 'flex', gap: 1, mt: 2, flexWrap: 'wrap' }}>
            <Button variant="contained" onClick={() => void api.petShow().then(() => api.petSay({ id: 'hi', text: `Hi! I'm ${c.name}. Looking good?`, mood: 'excited', ttl: 5000 }))}>
              {tr("Say hi")}
            </Button>
            <Button onClick={() => void api.petShow()}>{tr("Show pet")}</Button>
            <Button onClick={() => void api.petResetPosition()}>{tr("Reset position")}</Button>
          </Box>
          <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 2, lineHeight: 1.7 }}>
            {tr("Drag it anywhere, or throw it · Rub it to pet · Click for a fact or joke · Double-click to Ask · Right-click for options · Drop a file on it to teach it · Ctrl+Shift+P hides or shows it")}
          </Typography>
        </Box>

        {/* options */}
        <Box>
          <Section title="Pet">
            <Row title={tr("Show desktop pet")} hint={tr("Always on top of other windows. Click-through everywhere except the pet itself.")}>
              <Switch checked={c.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
            </Row>
            <Row title={tr("Name")}>
              <TextField size="small" value={c.name} onChange={(e) => set({ name: e.target.value.slice(0, 20) })} sx={{ width: 220, bgcolor: 'background.paper' }} />
            </Row>
          </Section>

          <Section title="Look">
            <Row title={tr("Species")}>
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', justifyContent: 'flex-end', maxWidth: 560 }}>
                {SPECIES.map((s) => (
                  <Chip key={s.id} on={c.species === s.id} label={tr(s.label)} onClick={() => set({ species: s.id as Species, color: s.color, accent: s.accent })}>
                    <PetSvg c={{ ...c, species: s.id, color: s.color, accent: s.accent }} p={{ ...pose, mood: 'idle', look: { x: 0, y: 0 } }} size={54} />
                  </Chip>
                ))}
              </Box>
            </Row>
            <Row title={tr("Colour")}>{swatches(c.color, (v) => set({ color: v }))}</Row>
            <Row title={tr("Accent")} hint={tr("Belly, ears, spots and muzzle.")}>{swatches(c.accent, (v) => set({ accent: v }))}</Row>
            <Row title={tr("Pattern")}>{items<Pattern>('pattern', ['none', 'belly', 'spots', 'stripes'], c.pattern, (v) => set({ pattern: v }))}</Row>
            <Row title={tr("Eyes")}>{items<Eyes>('eyes', ['sparkle', 'dots', 'anime', 'sleepy', 'happy'], c.eyes, (v) => set({ eyes: v }))}</Row>
            <Row title={tr("Head")}>{items<HeadItem>('head', ['none', 'beanie', 'cap', 'bow', 'flower', 'party', 'witch', 'santa', 'halo', 'crown', 'laurel'], c.head, (v) => set({ head: v }))}</Row>
            <Row title={tr("Face")}>{items<FaceItem>('face', ['none', 'glasses', 'blush', 'sunglasses', 'monocle'], c.face, (v) => set({ face: v }))}</Row>
            <Row title={tr("Neck")}>{items<NeckItem>('neck', ['none', 'scarf', 'bowtie', 'bell', 'bandana', 'medal'], c.neck, (v) => set({ neck: v }))}</Row>
            <Row title={tr("Size")}>
              <Slider sx={{ width: 240 }} min={0.6} max={1.6} step={0.05} value={c.size} onChange={(_e, v) => set({ size: v as number })} />
            </Row>
          </Section>

          <Section title="Voice and personality">
            <Row title={tr("Sound")}>
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                <Select size="small" value={c.sound} onChange={(e) => set({ sound: e.target.value as SoundPack })} sx={{ minWidth: 140, bgcolor: 'background.paper' }}>
                  {(['chirp', 'meow', 'beep', 'bloop', 'none'] as SoundPack[]).map((s) => (
                    <MenuItem key={s} value={s}>
                      {s === 'none' ? tr("Silent") : cap(s)}
                    </MenuItem>
                  ))}
                </Select>
                <Slider sx={{ width: 120 }} min={0} max={1} step={0.05} value={c.volume} onChange={(_e, v) => set({ volume: v as number })} aria-label={tr("Volume")} />
                <Button onClick={() => play(c.sound, 'happy', c.volume)}>{tr("Test")}</Button>
              </Box>
            </Row>
            <Row title={tr("Energy")} hint={tr("Calm pets sit still; hyper ones wander and bounce more.")}>
              <Slider sx={{ width: 240 }} min={0} max={1} step={0.05} value={c.energy} onChange={(_e, v) => set({ energy: v as number })} />
            </Row>
            <Row title={tr("Chattiness")} hint={tr("How often it shares a fact, joke or pep talk. Reminders always come through.")}>
              <Slider sx={{ width: 240 }} min={0} max={1} step={0.05} value={c.chattiness} onChange={(_e, v) => set({ chattiness: v as number })} />
            </Row>
            <Row title={tr("Sassy")} hint={tr("Playful teasing instead of pure wholesome.")}>
              <Switch checked={c.sassy} onChange={(e) => set({ sassy: e.target.checked })} />
            </Row>
            <Row title={tr("Language")} hint={tr("English and Japanese are built in; other languages are translated by your AI provider once and remembered.")}>
              <Select size="small" value={c.language} onChange={(e) => set({ language: e.target.value })} sx={{ minWidth: 220, bgcolor: 'background.paper' }} MenuProps={{ PaperProps: { sx: { maxHeight: 420 } } }}>
                {WORLD.map((w) => (
                  <MenuItem key={w.name} value={w.name}>
                    {w.native}
                    {w.native !== w.name ? ` · ${w.name}` : ''}
                  </MenuItem>
                ))}
              </Select>
            </Row>
          </Section>

          <Section title="What it talks about">
            <Row title={tr("Fun facts")}>
              <Switch checked={c.topics.facts} onChange={(e) => set({ topics: { ...c.topics, facts: e.target.checked } })} />
            </Row>
            <Row title={tr("Jokes")}>
              <Switch checked={c.topics.jokes} onChange={(e) => set({ topics: { ...c.topics, jokes: e.target.checked } })} />
            </Row>
            <Row title={tr("Motivation and breaks")}>
              <Switch checked={c.topics.motivation} onChange={(e) => set({ topics: { ...c.topics, motivation: e.target.checked } })} />
            </Row>
            <Row title={tr("Smart lines")} hint={tr("Lets your AI provider ({v0}) write fresh lines. Only the time and how many meetings are left are shared, never titles or notes.", { v0: ctx.settings.aiProvider === 'local' ? 'Gemma on this PC' : ctx.settings.aiProvider === 'gemini' ? 'Gemini' : 'API' })}>
              <Switch checked={c.smartLines} onChange={(e) => set({ smartLines: e.target.checked })} />
            </Row>
            <Row title={tr("It learns")} hint={tr("Tap 👍 on lines you like and ✕ on ones you don't; it adjusts what it says.")}>
              <Typography variant="body2" color="text.secondary">
                👍 {p.likes.facts + p.likes.jokes + p.likes.motivation} · ✕ {p.dislikes.facts + p.dislikes.jokes + p.dislikes.motivation}
              </Typography>
            </Row>
          </Section>

          <Section title="Behaviour">
            <Row title={tr("Wander around")} hint={tr("Strolls along the screen when you're not busy.")}>
              <Switch checked={c.wander} onChange={(e) => set({ wander: e.target.checked })} />
            </Row>
            <Row title={tr("Gravity")} hint={tr("Falls to the taskbar when you let go, and bounces when thrown.")}>
              <Switch checked={c.gravity} onChange={(e) => set({ gravity: e.target.checked })} />
            </Row>
            <Row title={tr("Hide in full-screen apps")} hint={tr("Steps aside during presentations, videos and games.")}>
              <Switch checked={c.hideFullscreen} onChange={(e) => set({ hideFullscreen: e.target.checked })} />
            </Row>
            <Row title={tr("Quiet hours")} hint={tr("No chatter and it naps. Meeting reminders still show.")}>
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                <Select size="small" value={String(c.quietStart)} onChange={(e) => set({ quietStart: Number(e.target.value) })} sx={{ bgcolor: 'background.paper' }}>
                  <MenuItem value="-1">{tr("Off")}</MenuItem>
                  {hours.map(([v, l]) => (
                    <MenuItem key={v} value={v}>
                      {tr(l)}
                    </MenuItem>
                  ))}
                </Select>
                <Typography variant="body2">{tr("to")}</Typography>
                <Select size="small" value={String(c.quietEnd)} disabled={c.quietStart < 0} onChange={(e) => set({ quietEnd: Number(e.target.value) })} sx={{ bgcolor: 'background.paper' }}>
                  {hours.map(([v, l]) => (
                    <MenuItem key={v} value={v}>
                      {tr(l)}
                    </MenuItem>
                  ))}
                </Select>
              </Box>
            </Row>
          </Section>
        </Box>
      </Box>
    </Box>
  )
}
