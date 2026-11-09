/** Directorio ficticio para las suites HTTP que deben atravesar UserService real sin consultar Algolia. */
import { userService } from '../../dist/services/userService.js'

export const testIdentityHeaders = { 'X-CiberNova-User-Id': 'test-user' }

export function mockUserDirectory(t, records = [{ objectID: 'test-user', displayName: 'Cliente de prueba', role: 'B2C', enabled: true }]) {
  t.mock.method(userService.directory, 'find', async id => records.find(record => record.objectID === id))
  t.mock.method(userService.directory, 'list', async () => records)
}
