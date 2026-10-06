import { describe, it, expect } from 'vitest'
import { defaultVoice, voiceLosesWork, type EditorVoice } from '@core/annotate'

/**
 * A book save sends the device's voice to the shelf. On 28 September 2026 a
 * device holding a pen name and nothing else wrote that over the editor's
 * card, and nothing said so. `voiceLosesWork` is what refuses it now.
 */
const built = (): EditorVoice => ({
  ...defaultVoice(),
  penName: 'Etsu T. Dhent',
  about: 'I write in the first person, singular, and I stay there.',
  guidance: 'STANCE\n\nKeep three registers separate and visible.',
  avoid: ['Use a long dash.', 'Compliment the reader.'],
  proseSamples: ['A man settles into an armchair in Chicago.']
})

describe('sending a voice over the one on the shelf', () => {
  it('refuses a card that is a pen name and nothing else', () => {
    const empty = { ...defaultVoice(), penName: 'Etsu T. Dhent' }
    expect(voiceLosesWork(built(), empty)).toMatch(/empty about, guidance, avoid, proseSamples/)
  })

  it('refuses a card that keeps its fields but has lost most of them', () => {
    const big = { ...built(), guidance: 'x'.repeat(2000) }
    expect(voiceLosesWork(big, built())).toMatch(/characters/)
  })

  it('lets an edit through: one refusal fewer, a line reworded', () => {
    const edited = {
      ...built(),
      avoid: ['Use a long dash.'],
      about: 'I write in the first person.'
    }
    expect(voiceLosesWork(built(), edited)).toBeNull()
  })

  it('lets a fuller card through', () => {
    const more = { ...built(), avoid: [...built().avoid, 'Say the point plainly.'] }
    expect(voiceLosesWork(built(), more)).toBeNull()
  })
})
