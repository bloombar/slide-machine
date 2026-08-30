/**
 * Registers every action, by importing each module for its side effect.
 *
 * Actions register themselves when their module loads, so "the registry" only
 * means anything once something has imported all of them. That used to be
 * app.ts alone, which made the full set reachable to the running server and
 * to nothing else — in particular not to a unit test, which is where the
 * access-completeness audit has to live (TECH-14).
 *
 * One list, imported by both. A new action file added here is registered
 * everywhere at once; added anywhere else, it is invisible to the audit.
 */
import './system'
import './project'
import './template'
import './deck'
import './deck-import'
import './deck-import-slides'
import './drive-import'
import './drive-picker'
import './reconcile'
import './slide'
import './user'
import './seed-asset'
import './quiz'
import './export'
import './billing'
import './social'
