/**
 * Vitest setup: registers jest-dom matchers and unmounts rendered
 * components between tests (auto-cleanup needs globals, which we keep off).
 */
import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

afterEach(cleanup)
