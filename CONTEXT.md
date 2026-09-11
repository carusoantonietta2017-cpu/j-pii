# j-pii

Local PII-masking hook for the pi coding agent, powered by vendored rizzo-pii: sensitive values never reach the LLM, placeholders travel instead, real values are restored locally on the way back.

## Language

**Placeholder**:
The opaque code (e.g. `[PERSONA_1]`) that replaces a sensitive value in everything sent to the LLM.
_Avoid_: codice, token, tag

**Mapping**:
The local-only placeholder→value dictionary that makes the round-trip reversible. It never leaves the machine.
_Avoid_: dizionario, lookup table

**Mask**:
The outbound pass: detect PII in LLM-bound text and replace each value with its placeholder.
_Avoid_: anonimizzare, oscurare, redact

**Restore**:
The inbound pass: replace placeholders in the LLM response (and in tool-written files) with the real values from the mapping.
_Avoid_: de-anonimizzare, unmask, decode

**Doubtful span**:
A text span the detector flags below the block threshold: the hook stops, shows it, and offers force-masking instead of guessing.
_Avoid_: uncertain entity, low-confidence match
