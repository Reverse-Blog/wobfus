<h1 align="center">wobfus</h1>

<p align="center">
  <img src="./trident.png" alt="Wobfus trident" width="240">
</p>

<p align="center">
  Experimental JavaScript VM obfuscation with anti-LLM techniques.
</p>

## What it does

Wobfus transforms JavaScript into a less readable form while aiming to preserve
its behavior. The browser playground lets you edit, obfuscate, inspect, and run
the result.

## Anti-LLM obfuscation

The demo combines several techniques intended to make code harder to follow
for humans and language models:

- Randomized internal names and instructions.
- Rare characters mixed with invisible Unicode.
- Hidden text and indirect access to properties.
- Execution through a custom virtual machine.

**This is an experimental demo, not a security feature.** “Anti-LLM” describes
the intent, not proven resistance: the output can still be executed, inspected,
and reverse-engineered.

Not all JavaScript features are supported. Always review the result and never
run code from untrusted sources.
