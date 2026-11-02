/** Compila los contratos CN-51 de cada aplicación con casos compartidos, strict y noEmit. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// TypeScript 7 del Server no expone Compiler API. Usamos la instalada en Client;
// el build del Server comprueba además los contratos con su propio compilador.
const requireClient = createRequire(new URL('../../client/package.json', import.meta.url))
const ts = requireClient('typescript')

// Fixture virtual: no genera archivos ni imports entre código Client y Server.
const fixture = `
import type { UserId, UserRole, Company, B2CUser, B2BUser, AdminUser, ResolvedUser } from '../src/types/user.js'
import type { BranchId, Branch } from '../src/types/branch.js'
import type { PricingType, CommercialContext } from '../src/types/commercial.js'

const id: UserId = 'user-1'
const roles: UserRole[] = ['B2C', 'B2B', 'ADMIN']
const company: Company = { id: 'company-1', name: 'Empresa de prueba' }
const consumer: B2CUser = { id, displayName: 'Consumidor', role: 'B2C' }
const business: B2BUser = { id, displayName: 'Empresa', role: 'B2B', company }
const admin: AdminUser = { id, displayName: 'Administrador', role: 'ADMIN' }
const users: ResolvedUser[] = [consumer, business, admin]
const branchIds: BranchId[] = ['san_jose', 'alajuela', 'cartago', 'heredia']
const branch: Branch = { id: 'san_jose', name: 'San José' }
const pricingTypes: PricingType[] = ['RETAIL', 'WHOLESALE']
const contexts: CommercialContext[] = [
  { user: consumer, pricingType: 'RETAIL', branchId: null },
  { user: consumer, pricingType: 'RETAIL', branchId: branch.id },
  { user: business, pricingType: 'WHOLESALE', branchId: null },
  { user: business, pricingType: 'WHOLESALE', branchId: 'heredia' },
  { user: admin, pricingType: null, branchId: null },
]

// @ts-expect-error UserId sigue siendo un identificador de texto.
const invalidId: UserId = 1
// @ts-expect-error Solo se admiten los tres roles aprobados.
const invalidRole: UserRole = 'GUEST'
// @ts-expect-error Los nombres visibles no son identificadores de sucursal.
const invalidBranch: BranchId = 'San José'
// @ts-expect-error No existen sucursales fuera del conjunto aprobado.
const unknownBranch: Branch = { id: 'limon', name: 'Limón' }
// @ts-expect-error Solo se admiten los tipos de precio aprobados.
const invalidPricing: PricingType = 'DISCOUNT'
// @ts-expect-error La identidad exige displayName.
const unnamedUser: ResolvedUser = { id, role: 'B2C' }
// @ts-expect-error B2B exige Company.
const businessWithoutCompany: ResolvedUser = { id, displayName: 'Empresa', role: 'B2B' }
// @ts-expect-error Company exige id y name.
const incompleteCompany: Company = { id: 'company-1' }
// @ts-expect-error Una Company presente tampoco puede omitirse mediante undefined.
const undefinedCompany: B2BUser = { id, displayName: 'Empresa', role: 'B2B', company: undefined }
const consumerWithCompany = { ...consumer, company }
const adminWithCompany = { ...admin, company }
// @ts-expect-error B2C rechaza Company incluso desde un objeto previamente creado.
const invalidConsumer: ResolvedUser = consumerWithCompany
// @ts-expect-error ADMIN rechaza Company incluso desde un objeto previamente creado.
const invalidAdmin: ResolvedUser = adminWithCompany
// @ts-expect-error B2C no utiliza precios mayoristas.
const wholesaleConsumer: CommercialContext = { user: consumer, pricingType: 'WHOLESALE', branchId: null }
// @ts-expect-error B2B no utiliza precios minoristas.
const retailBusiness: CommercialContext = { user: business, pricingType: 'RETAIL', branchId: null }
// @ts-expect-error Una identidad compradora no utiliza el contexto ADMIN.
const unpricedConsumer: CommercialContext = { user: consumer, pricingType: null, branchId: null }
// @ts-expect-error ADMIN no tiene tipo de precio de compra.
const purchasingAdmin: CommercialContext = { user: admin, pricingType: 'RETAIL', branchId: null }
// @ts-expect-error ADMIN no selecciona una sucursal de compra.
const branchedAdmin: CommercialContext = { user: admin, pricingType: null, branchId: 'cartago' }
// @ts-expect-error branchId es obligatorio aunque todavía pueda ser null.
const missingBranch: CommercialContext = { user: consumer, pricingType: 'RETAIL' }
// @ts-expect-error No se admite una sucursal desconocida en el contexto.
const unknownContextBranch: CommercialContext = { user: business, pricingType: 'WHOLESALE', branchId: 'limon' }

function narrowUser(user: ResolvedUser) {
  switch (user.role) {
    case 'B2B': {
      const business: B2BUser = user
      const company: Company = user.company
      return company.name
    }
    case 'B2C': {
      const consumer: B2CUser = user
      const absentCompany: undefined = user.company
      return consumer.displayName
    }
    case 'ADMIN': {
      const admin: AdminUser = user
      const absentCompany: undefined = user.company
      return admin.displayName
    }
    default: {
      const exhaustive: never = user
      return exhaustive
    }
  }
}

function narrowContext(context: CommercialContext) {
  switch (context.pricingType) {
    case 'WHOLESALE': {
      const business: B2BUser = context.user
      const branch: BranchId | null = context.branchId
      return business.company.name
    }
    case 'RETAIL': {
      const consumer: B2CUser = context.user
      const branch: BranchId | null = context.branchId
      return consumer.displayName
    }
    case null: {
      const admin: AdminUser = context.user
      const branch: null = context.branchId
      return admin.displayName
    }
    default: {
      const exhaustive: never = context
      return exhaustive
    }
  }
}

// Compatibilidad estructural contra la misma forma pública en ambas aplicaciones.
type ExpectedUser = { id: string; displayName: string } & (
  | { role: 'B2C'; company?: never }
  | { role: 'B2B'; company: { id: string; name: string } }
  | { role: 'ADMIN'; company?: never }
)
type ExpectedContext =
  | { user: Extract<ExpectedUser, { role: 'B2C' }>; pricingType: 'RETAIL'; branchId: BranchId | null }
  | { user: Extract<ExpectedUser, { role: 'B2B' }>; pricingType: 'WHOLESALE'; branchId: BranchId | null }
  | { user: Extract<ExpectedUser, { role: 'ADMIN' }>; pricingType: null; branchId: null }
declare const expectedUser: ExpectedUser
declare const resolvedUser: ResolvedUser
declare const expectedContext: ExpectedContext
declare const commercialContext: CommercialContext
const userToPublic: ExpectedUser = resolvedUser
const publicToUser: ResolvedUser = expectedUser
const contextToPublic: ExpectedContext = commercialContext
const publicToContext: CommercialContext = expectedContext
`

for (const application of ['client', 'server']) {
  test(`CN-51 ${application}: contratos, narrowing y rechazos bajo strict sin emitir archivos`, () => {
    const applicationUrl = new URL(`../../${application}/`, import.meta.url)
    const fixturePath = fileURLToPath(new URL('tests/__cn51_contracts__.ts', applicationUrl))
    const options = {
      target: ts.ScriptTarget.ES2023,
      module: application === 'client' ? ts.ModuleKind.ESNext : ts.ModuleKind.NodeNext,
      moduleResolution: application === 'client' ? ts.ModuleResolutionKind.Bundler : ts.ModuleResolutionKind.NodeNext,
      strict: true,
      noEmit: true,
      types: [],
      skipLibCheck: true,
      erasableSyntaxOnly: true,
    }
    const host = ts.createCompilerHost(options)
    const originalGetSourceFile = host.getSourceFile.bind(host)
    host.getSourceFile = (fileName, languageVersion, onError, shouldCreateNewSourceFile) =>
      resolve(fileName) === fixturePath
        ? ts.createSourceFile(fileName, fixture, languageVersion, true)
        : originalGetSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile)
    const program = ts.createProgram([fixturePath], options, host)
    const diagnostics = ts.getPreEmitDiagnostics(program)
    const formatted = ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCanonicalFileName: fileName => fileName,
      getCurrentDirectory: () => fileURLToPath(applicationUrl),
      getNewLine: () => '\n',
    })
    assert.equal(diagnostics.length, 0, formatted)
  })
}
