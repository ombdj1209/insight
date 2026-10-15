export interface NoteTemplate {
  id: string
  label: string
  instructions: string
}

export const TEMPLATES: NoteTemplate[] = [
  { id: 'general', label: 'General', instructions: '' },
  {
    id: 'client',
    label: 'Client call',
    instructions:
      'Structure: Context, Client needs and pain points, What we proposed, Pricing / scope / timeline mentioned, Objections and open questions, Next steps (who owes what to whom).'
  },
  {
    id: 'standup',
    label: 'Team standup',
    instructions: 'Structure: one section per person with Done / Doing / Blocked, then Team decisions and Action items. Keep it terse.'
  },
  {
    id: 'one-on-one',
    label: '1:1',
    instructions: 'Structure: Wins, Concerns, Feedback given and received, Career / growth topics, Agreed follow-ups.'
  },
  {
    id: 'interview',
    label: 'Interview',
    instructions:
      'Structure: Candidate background, Answers per question asked (with evidence), Strengths, Concerns, Overall signal. Quote the candidate exactly for key claims.'
  },
  {
    id: 'sales',
    label: 'Sales discovery',
    instructions: 'Structure: Company and stakeholders, Current process, Pain and impact, Budget, Authority, Need, Timeline, Competitors mentioned, Next step.'
  },
  {
    id: 'kickoff',
    label: 'Project kickoff',
    instructions: 'Structure: Goals, Scope (in / out), Deliverables, Milestones and dates, Roles and owners, Risks, Open questions.'
  }
]

export const templateById = (id?: string): NoteTemplate => TEMPLATES.find((t) => t.id === id) ?? TEMPLATES[0]
