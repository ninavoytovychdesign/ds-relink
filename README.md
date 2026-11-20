# DS Relink

A Figma plugin that makes variables, styles and components coming from other files local, and relinks the screens to the local copies.

You copy a few flows into a clean file and everything still points at the library it came from. The screens look right but nothing is yours: the variables are remote, the components are instances of someone else's file, and the moment the library moves, the file breaks. DS Relink walks the layers, recreates those variables, styles and components locally under the same names, and rebinds every layer to the local ones.

**Duplicate the file before the first run.** Everything the plugin does is one undo step (Cmd/Ctrl+Z), but a duplicate costs nothing.

## What it does

**Scope** – the whole file, the current page, or just the selection.

**Components** – instances of components from other files are switched to local components. If the file doesn't have a matching one, the plugin can create it on a page called *Local components · DS Relink*, including variant sets.

**Variables and styles** – colours, spacing, text styles and effects coming from libraries become local ones with the same names. Variables and styles that already exist locally are reused rather than duplicated.

**Unbound values** – colours with no variable and text with no style can be bound to the file's own variables and styles, exact matches only. If nothing matches, the plugin can create new entries under *DS Relink · found colors* and *DS Relink/…* – those are deliberately marked so you can review them afterwards instead of trusting them blindly.

**Check without changes** – a dry run. The plugin reports exactly what it would do, down to the counts, and changes nothing. That's the intended first step.

## The report

After each run the panel shows what happened: layers checked, instances from other files and how many were switched to local, components and variant sets created, variables and styles created versus reused, bindings relinked, colours bound to variables, texts bound to styles, and errors. Anything the plugin couldn't handle is grouped by reason, so a run that goes halfway tells you why.

The interface is available in English and Ukrainian.

## Installing it locally

The plugin is plain JavaScript – there is no build step.

In Figma: **Plugins → Development → Import plugin from manifest…** and pick `manifest.json` from this folder.

## Files

| File | |
|---|---|
| `manifest.json` | plugin manifest |
| `code.js` | the plugin itself: scanning, importing variables and styles, swapping instances, rebinding layers |
| `ui.html` | the panel: options, progress and the report |

## Notes

- The plugin runs offline – `networkAccess` is set to `none`, it sends nothing anywhere.
- Layers inside instances are skipped where Figma doesn't allow writing to them; those show up in the report rather than failing silently.
- Issue details are rendered in the language of the run that produced them. Switching the language and running the check again re-renders them.
