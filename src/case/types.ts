export type Eye = 'right' | 'left' | 'both' | null

export interface Finding {
  id: string
  eye: Eye
  label: string
  value: string | number | null
  unit: string | null
  method: string | null
  available: boolean
  unavailable_reason?: string
}

export interface CaseFile {
  case_id: string
  title: string
  opening_prompt: string
  patient: {
    age: number
    sex: string
    presenting_complaint: string
    past_ocular_history: string
    past_medical_history: string
    medications: string[]
    allergies: string
    family_history: string
  }
  findings: Finding[]
  examiner_notes: {
    diagnosis: string
    key_points: string[]
    follow_up_ideas: string[]
  }
  reference_source: { title: string; file: string; note: string }
}

/** What the trainee was told about one finding, frozen at the time it was revealed. */
export interface RevealedFinding {
  id: string
  eye: Eye
  label: string
  available: boolean
  display: string
}

export interface FindingsReply {
  revealed: RevealedFinding[]
  spoken: string
}
