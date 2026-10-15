/** Everything the pet can say offline. Facts are kept to well-established ones. */
import type { Topic } from './pet'

type Lang = 'en' | 'ja'
/** built-in line set for a pet language: Japanese has its own, everything else starts from English and is translated */
export const lineSet = (language: string): Lang => (language === 'Japanese' || language === 'ja' ? 'ja' : 'en')

const FACTS: Record<Lang, string[]> = {
  en: [
    'Octopuses have three hearts.',
    'A group of flamingos is called a flamboyance.',
    "Botanically, bananas are berries, but strawberries aren't.",
    'Wombat poop is cube-shaped.',
    'Sea otters sometimes hold hands while sleeping so they don’t drift apart.',
    'A day on Venus is longer than a year on Venus.',
    'The Eiffel Tower can grow about 15 cm taller in summer as the metal expands.',
    'Butterflies taste with their feet.',
    'Sharks have been around longer than trees.',
    'Koalas can sleep up to 20 hours a day.',
    'Lightning is about five times hotter than the surface of the Sun.',
    'Gentoo penguins give pebbles to the penguin they like.',
    'The shortest war in history lasted under an hour.',
    "Cats can't taste sweetness.",
    'A teaspoon of neutron star would weigh about a billion tonnes.',
    'Honeybees can learn to recognise human faces.',
    "Scotland's national animal is the unicorn.",
    "About two-thirds of an octopus's neurons are in its arms.",
    'At its triple point, water can boil and freeze at the same time.',
    'The first computer "bug" was a real moth, found in 1947.',
    'The word "robot" comes from the Czech "robota", meaning forced labour.',
    'Sloths can hold their breath for up to 40 minutes.',
    'A pineapple takes about two years to grow.',
    'Some bamboo can grow nearly a metre in a single day.',
    'Hummingbirds can fly backwards.',
    'Your brain uses about 20% of your body’s energy.',
    'A group of crows is called a murder.',
    'Antarctica is the largest desert on Earth.',
    'Saturn is less dense than water.',
    'Some turtles can breathe through their bottoms.',
    'The Great Wall of China is not visible from space with the naked eye.',
    'Dolphins call each other by unique signature whistles, like names.',
    'Rats laugh when tickled, just too high-pitched for us to hear.',
    'The dot over an "i" or "j" is called a tittle.',
    '"Rhythms" is one of the longest English words without a, e, i, o or u.',
    'Venus spins the opposite way to most planets.',
    'A fluffy cumulus cloud can weigh around 500 tonnes.',
    "Adult elephants can't jump.",
    "The inventor of the Pringles can had some of his ashes buried in one.",
    'Bubble wrap was first invented as wallpaper.',
    'There are more possible chess games than atoms in the observable universe.',
    'Short breaks during long tasks help you stay focused.',
    'Writing something down helps you remember it.',
    'Looking at something 6 metres away for 20 seconds gives your eyes a rest.'
  ],
  ja: [
    'タコには心臓が3つあります。',
    'バナナは植物学的にはベリーですが、イチゴは違います。',
    'ウォンバットのフンは四角い形です。',
    'ラッコは寝るとき、流されないように手をつなぐことがあります。',
    '金星では1日が1年より長いです。',
    '夏のエッフェル塔は熱で約15cm高くなります。',
    'チョウは足で味を感じます。',
    'サメは木よりも昔から地球にいます。',
    'コアラは1日に最大20時間ほど眠ります。',
    '雷は太陽の表面より約5倍熱いです。',
    'ネコは甘味を感じられません。',
    'スコットランドの国獣はユニコーンです。',
    '南極大陸は世界最大の砂漠です。',
    '土星は水よりも密度が小さいです。',
    '大人のゾウはジャンプできません。',
    'ネズミはくすぐられると笑います。人には聞こえない高い声で。',
    '最初の「コンピューターのバグ」は1947年に見つかった本物の蛾でした。',
    '「ロボット」はチェコ語の「robota（強制労働）」が語源です。',
    '脳は体のエネルギーの約20%を使います。',
    '竹の中には1日に1メートル近く伸びるものもあります。',
    '短い休憩をはさむと集中力が続きやすくなります。',
    '書き出すと、覚えやすくなります。'
  ]
}

const JOKES: Record<Lang, string[]> = {
  en: [
    'Why did the scarecrow get promoted? He was outstanding in his field.',
    'I told my computer I needed a break. It said: "No problem, I’ll go to sleep."',
    "Why don't skeletons fight each other? They don't have the guts.",
    'Why was the calendar so popular? It had a lot of dates.',
    "I'm reading a book about anti-gravity. It's impossible to put down.",
    'Why do programmers prefer dark mode? Because light attracts bugs.',
    "Parallel lines have so much in common. Shame they'll never meet.",
    'Why did the meeting go so smoothly? Everyone was on mute.',
    'What do you call a meeting that could have been an email? Tuesday.',
    'Why did the coffee file a police report? It got mugged.',
    "What's a computer's favourite snack? Microchips.",
    "Why don't eggs tell jokes? They'd crack each other up.",
    'I asked the Wi-Fi out. We had a real connection.',
    'What do you call fake spaghetti? An impasta.',
    'How do trees get online? They log in.',
    'Why did the developer go broke? He used up all his cache.',
    'Why did the bicycle fall over? It was two-tired.',
    'What did the ocean say to the beach? Nothing, it just waved.',
    'Why are frogs so happy? They eat whatever bugs them.',
    'What do you call a bear with no teeth? A gummy bear.',
    'Why did the maths book look sad? Too many problems.',
    "What's the best thing about Switzerland? Not sure, but the flag is a big plus.",
    "Why can't you trust atoms? They make up everything.",
    'The claustrophobic astronaut? He just needed a little space.',
    'Why did the cookie go to the doctor? It felt crummy.',
    'What do you call a sleeping dinosaur? A dino-snore.',
    'I tried to catch fog yesterday. Mist.',
    'I have a joke about the agenda, but we’ll get to it later.',
    'Why did the slide deck cross the road? To get to the other slide.',
    'Why was the computer cold? It left its Windows open.',
    'What do you call an alligator in a vest? An investigator.',
    'My calendar says "take a break". Who am I to argue?'
  ],
  ja: ['布団が吹っ飛んだ！', 'アルミ缶の上にあるミカン。', 'イクラはいくら？', '電話に出んわ。', 'このカレー、辛ぇ〜。', 'トイレに行っといれ。', 'ダジャレを言うのは誰じゃ。', 'カエルが帰る。', '猫が寝ころんだ。', 'カメラをかめら（噛めら）ないで。']
}

const PEP: Record<Lang, string[]> = {
  en: [
    "You've got this. One thing at a time.",
    'Small progress is still progress.',
    'Drink some water. Future you says thanks.',
    'You showed up today. That counts.',
    'Done is better than perfect.',
    'Deep breath in… and out. Nice.',
    'Sit tall! Your back will thank you.',
    'Be kind to yourself today.',
    'Look away from the screen for 20 seconds. Your eyes deserve it.',
    "You're doing better than you think.",
    'Celebrate the small wins. I’ll start: yay you!',
    "Roll your shoulders. I'll do it with you.",
    'Focus on what you can control.',
    'A short walk can reset your brain.',
    "You don't have to do everything today.",
    'Proud of you for keeping at it.',
    'Breaks are part of the work, not a reward for it.',
    'Every expert was once a beginner.',
    'Plan the next step, not the whole staircase.',
    'Shoulders down, jaw unclenched. There you go.',
    'Remember to eat something good today.',
    'You make this desk a happier place.'
  ],
  ja: [
    '大丈夫、ひとつずつやっていこう。',
    '小さな進歩も進歩だよ。',
    'お水を飲もう。未来の自分が喜ぶよ。',
    '今日も来てえらい！',
    '完璧より、まず完成。',
    '深呼吸しよう。吸って…吐いて。いいね。',
    '背筋をのばそう！',
    '今日は自分にやさしくね。',
    '20秒だけ画面から目を離してみて。',
    '思っているより、ちゃんとできてるよ。',
    '小さな勝ちをお祝いしよう。すごい！',
    '肩をまわそう。いっしょにやるね。',
    '少し歩くと頭がすっきりするよ。',
    '今日ぜんぶやらなくても大丈夫。',
    'がんばってるの、ちゃんと見てるよ。',
    '休憩も仕事のうちだよ。',
    '次の一歩だけ考えよう。',
    '肩の力を抜いて。そうそう。'
  ]
}

export const POOLS: Record<Topic, Record<Lang, string[]>> = { facts: FACTS, jokes: JOKES, motivation: PEP }

const pick = <T,>(a: T[]): T => a[Math.floor(Math.random() * a.length)]

/** Lines tied to events. `s` = sassy personality. */
export function say(language: string, s: boolean) {
  const ja = lineSet(language) === 'ja'
  return {
    greet: (name: string, h: number): string =>
      ja
        ? h < 11 ? `おはよう${name ? '、' + name : ''}！` : h < 18 ? `こんにちは${name ? '、' + name : ''}！` : `おつかれさま${name ? '、' + name : ''}！`
        : h < 11 ? `Good morning${name ? ', ' + name : ''}!` : h < 18 ? `Hey${name ? ' ' + name : ''}! Good afternoon.` : `Good evening${name ? ', ' + name : ''}!`,
    brief: (n: number, first?: string, at?: string): string =>
      ja
        ? n ? `今日は会議が${n}件。最初は${at}の「${first}」だよ。` : '今日は会議なし！集中タイムだね。'
        : n ? `${n} meeting${n > 1 ? 's' : ''} today. First up: ${first} at ${at}.` : s ? 'Zero meetings today. Suspicious. Enjoy it.' : 'No meetings today. Deep work time!',
    soon: (title: string, m: number): string => (ja ? `「${title}」まであと${m}分だよ。` : s ? `Psst. ${title} in ${m} min. Act like you were ready.` : `${title} starts in ${m} min.`),
    now: (title: string): string => (ja ? `「${title}」がはじまるよ！` : s ? `${title} is starting. Cameras on, smile on.` : `${title} is starting!`),
    listening: (): string => (ja ? 'メモ取ってるね。まかせて！' : s ? "Taking notes. You just look smart." : "I'm taking notes. You just talk!"),
    done: (title: string): string => (ja ? `「${title}」おつかれさま！メモをまとめようか？` : s ? `Survived ${title}. Want me to write it up?` : `Nice work on ${title}! Want me to write up the notes?`),
    writing: (): string => (ja ? 'メモを書いてるよ…' : 'Writing your notes…'),
    notes: (n: number): string => (ja ? (n ? `できた！アクションアイテムが${n}件あるよ。` : 'できた！メモをまとめたよ。') : n ? `Done! You have ${n} action item${n > 1 ? 's' : ''}.` : 'Done! Your notes are ready.'),
    notesErr: (why: string): string => (ja ? `メモが書けなかった… ${why}` : `I couldn't write the notes: ${why}`),
    fed: (file: string): string => (ja ? `もぐもぐ… 「${file}」を覚えたよ！` : s ? `Om nom. ${file}. Tasty. I know it now.` : `Yum! I learned ${file}.`),
    fedErr: (): string => (ja ? 'それは食べられないみたい…' : "Hmm, I can't eat that one."),
    level: (n: number, unlock: string): string => (ja ? `レベル${n}になった！${unlock ? unlock + 'が解放されたよ。' : ''}` : `Level ${n}! ${unlock ? `Unlocked: ${unlock}.` : 'Thanks for hanging out.'}`),
    stretch: (): string => (ja ? '会議つづきだね。いっしょにのびーってしよう！' : s ? 'Two hours of calls. Your spine filed a complaint. Stretch!' : "That's a lot of meetings. Stretch with me!"),
    last: (): string => (ja ? '今日の会議はこれで最後！' : s ? 'That was the last meeting. Freedom.' : 'That was your last meeting today!'),
    friday: (): string => (ja ? '金曜日だ！あと少し！' : s ? "It's Friday. Act natural." : "It's Friday! Almost there."),
    petted: (): string => pick(ja ? ['えへへ', 'くすぐったい！', '♥', 'もっと〜'] : s ? ['Fine. Keep going.', 'Acceptable.', '♥', 'Okay, that was nice.'] : ['Hehe!', 'That tickles!', '♥', 'More please!']),
    thrown: (): string => pick(ja ? ['わーい！', 'もう一回！', 'めがまわる〜'] : ['Wheee!', 'Again!', 'Woah, dizzy…']),
    wake: (): string => (ja ? 'はっ！起きてたよ。' : "Huh? I'm awake! Totally awake."),
    shoo: (): string => (ja ? 'じゃあ1時間あとでね！' : 'Okay, see you in an hour!'),
    hello: (): string => (ja ? 'やっほー！' : pick(['Hi!', 'Hello there!', 'Hey!'])),
    briefReady: (title: string): string => (ja ? `「${title}」のブリーフができたよ。読んでおく？` : s ? `Brief for ${title} is ready. Walk in looking prepared.` : `Your brief for ${title} is ready.`),
    promise: (text: string, due: string | null, who?: string): string => {
      const today = new Date().toISOString().slice(0, 10)
      const when = !due ? '' : due < today ? (ja ? '（期限切れ）' : ' (overdue)') : due === today ? (ja ? '（今日まで）' : ' (due today)') : ja ? '（明日まで）' : ' (due tomorrow)'
      return ja ? `約束: ${text}${who ? `（${who}さんへ）` : ''}${when}` : s ? `You promised${who ? ` ${who}` : ''}: ${text}${when}. No pressure. Some pressure.` : `Reminder: you promised${who ? ` ${who}` : ''} to ${text.charAt(0).toLowerCase() + text.slice(1)}${when}.`
    },
    callStarted: (app: string): string => (ja ? `${app}で通話が始まったみたい。メモを取ろうか？` : s ? `Call in ${app}? I'll take notes, you look busy.` : `Looks like a call started in ${app}. Want me to take notes?`),
    voiceListen: (): string => (ja ? 'どうぞ、聞いてるよ…' : "I'm listening… ask me anything."),
    voiceThink: (): string => (ja ? 'ちょっと考えるね…' : 'Let me look that up…'),
    voiceMiss: (): string => (ja ? 'うまく聞き取れなかった。もう一回？' : "Sorry, I didn't catch that. Try again?"),
    badge: (label: string, reward?: string): string =>
      ja ? `バッジ獲得：「${label}」！${reward ? `${reward}がもらえたよ。` : ''}` : `New badge: ${label}!${reward ? ` You unlocked the ${reward}.` : ''}`,
    recap: (n: number, hours: string, kept: number): string =>
      ja ? `今週は会議${n}件、${hours}。約束を${kept}件まもったね。おつかれさま！` : s ? `${n} meetings, ${hours}. You kept ${kept} promises. Weekend: earned.` : `Your week: ${n} meetings, ${hours}, ${kept} promises kept. Nice work!`,
    busy: (): string => (ja ? '今日は会議続きだね…がんばろう！' : "Back-to-back meetings today. We've got this!"),
    callEnded: (): string => (ja ? '通話が終わったみたい。メモを止める？' : 'Looks like the call ended. Stop taking notes?'),
    promiseDone: (): string => (ja ? 'えらい！約束まもったね。' : pick(['Promise kept!', 'Done and done.', 'Look at you, keeping promises.']))
  }
}
