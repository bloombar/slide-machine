/**
 * Registers every MCP tool, by importing each module for its side effect.
 *
 * The same arrangement the action layer uses, for the same reason: "every
 * tool" is only meaningful once something has imported all of them, and that
 * something must be one list shared by the server and by the tests. A tool
 * file added here is advertised and audited at once; added anywhere else, it
 * is invisible to the test that checks no tool reaches a forbidden action.
 */
import './lectures'
import './slides'
import './templates'
