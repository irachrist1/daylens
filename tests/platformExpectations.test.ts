import test from 'node:test'
import assert from 'node:assert/strict'
import { getWorkspaceDeviceLabel } from '../src/shared/platformExpectations.ts'

test('workspace device labels stay platform-neutral when hostname is unavailable', () => {
  assert.equal(getWorkspaceDeviceLabel(''), 'This device')
  assert.equal(getWorkspaceDeviceLabel('  '), 'This device')
  assert.equal(getWorkspaceDeviceLabel('Tonny-Laptop'), 'Tonny-Laptop')
})
