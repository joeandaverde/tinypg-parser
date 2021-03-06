export interface SqlParseResult {
   parameterized_sql: string
   mapping: ParamMapping[]
}

export interface ParamMapping {
   index: number
   name: string
}
