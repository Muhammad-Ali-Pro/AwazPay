import { useEffect, useRef, useState } from 'react'
import { AccessibleButton } from '../components/AccessibleButton'
import { useAppDispatch, useAppState } from '../state/store'
import { useAnnouncer } from '../state/announcer'
import { STANDARD_TRANSACTION_LIMIT, TRUSTED_AUTHORIZATION_LABEL } from '../engines/securityEngine'

/**
 * Trusted Circle management.
 *
 * People here are asked to approve transactions above the standard limit.
 * The approval is simulated in this prototype, and deliberately does not
 * involve anyone reading a code aloud; see the note in securityEngine.
 */
export function TrustedCircle() {
  const { trustedCircle, settings } = useAppState()
  const dispatch = useAppDispatch()
  const { announce } = useAnnouncer()
  const [name, setName] = useState('')
  const [relationship, setRelationship] = useState('')
  const spokenRef = useRef(false)

  useEffect(() => {
    if (spokenRef.current) return
    spokenRef.current = true
    announce(
      trustedCircle.length
        ? `Trusted Circle. You have ${trustedCircle.length} trusted ${trustedCircle.length === 1 ? 'contact' : 'contacts'}. They are asked to approve payments above your standard limit.`
        : 'Trusted Circle. You have no trusted contacts yet. Add one so large payments can be approved.',
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function addContact() {
    const trimmed = name.trim()
    if (!trimmed) return
    dispatch({
      type: 'ADD_TRUSTED_CONTACT',
      contact: { id: `tc-${Date.now()}`, name: trimmed, relationship: relationship.trim() || 'Trusted Contact' },
    })
    announce(`${trimmed} has been added to your Trusted Circle.`)
    setName('')
    setRelationship('')
  }

  function removeContact(id: string, contactName: string) {
    dispatch({ type: 'REMOVE_TRUSTED_CONTACT', id })
    announce(`${contactName} has been removed from your Trusted Circle.`)
  }

  return (
    <div className="text-white">
      <h1 className="text-2xl font-bold">Trusted Circle</h1>
      <p className="mt-2 text-white/70">
        Payments above PKR {settings.transactionLimit.toLocaleString('en-US')} need approval from someone in your
        Trusted Circle. The AwazPay default limit is PKR {STANDARD_TRANSACTION_LIMIT.toLocaleString('en-US')}.
      </p>

      <div className="mt-4 rounded-2xl border border-dashed border-cyan/40 bg-cyan/5 p-4">
        <p className="text-sm font-semibold text-cyan-light">{TRUSTED_AUTHORIZATION_LABEL}</p>
        <p className="mt-2 text-xs leading-relaxed text-white/60">
          Your trusted contact approves on their own device. They never read a code aloud to you, and no
          one-time password is ever shared between you. In this prototype the approval is simulated, and no real
          message is sent to anybody.
        </p>
      </div>

      <ul className="mt-6 flex flex-col gap-3">
        {trustedCircle.map((contact) => (
          <li
            key={contact.id}
            className="flex items-center justify-between rounded-2xl border border-white/10 bg-midnight-800 p-4"
          >
            <div>
              <p className="font-semibold">{contact.name}</p>
              <p className="text-xs text-white/50">{contact.relationship}</p>
            </div>
            <button
              type="button"
              onClick={() => removeContact(contact.id, contact.name)}
              className="min-h-[44px] rounded-full border border-white/15 px-4 py-2 text-xs text-white/70 hover:bg-white/5 focus-visible:outline focus-visible:outline-4 focus-visible:outline-cyan"
              aria-label={`Remove ${contact.name} from Trusted Circle`}
            >
              Remove
            </button>
          </li>
        ))}
        {trustedCircle.length === 0 && (
          <p className="text-white/50">
            No trusted contacts yet. Payments above your limit will be declined until you add one.
          </p>
        )}
      </ul>

      <div className="mt-8 flex flex-col gap-3 rounded-2xl border border-white/10 bg-midnight-800 p-4">
        <h2 className="text-lg font-semibold">Add a trusted contact</h2>
        <label htmlFor="contact-name" className="text-sm text-white/70">
          Contact name
        </label>
        <input
          id="contact-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="rounded-xl border border-white/15 bg-midnight-700 px-4 py-3 text-white"
        />
        <label htmlFor="contact-relationship" className="text-sm text-white/70">
          Relationship
        </label>
        <input
          id="contact-relationship"
          value={relationship}
          onChange={(e) => setRelationship(e.target.value)}
          placeholder="e.g. Brother"
          className="rounded-xl border border-white/15 bg-midnight-700 px-4 py-3 text-white placeholder-white/25"
        />
        <AccessibleButton onClick={addContact} disabled={!name.trim()}>
          Add Trusted Contact
        </AccessibleButton>
      </div>
    </div>
  )
}
