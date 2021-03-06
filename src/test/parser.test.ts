import * as P from '../parser'
import * as T from '../types'

describe('parseSql', () => {
   let parse_result: T.SqlParseResult | null = null

   beforeAll(() => {
      parse_result = P.parseSql('SELECT * FROM users where id = :id and name = :name')
   })

   test('should replace the detected variables with postgres variable indexes', () => {
      expect(parse_result!.parameterized_sql).toEqual('SELECT * FROM users where id = $1 and name = $2')
   })

   test('should return the mapping of postgres vars to names', () => {
      expect(parse_result!.mapping).toEqual([{ name: 'id', index: 1 }, { name: 'name', index: 2 }])
   })

   describe('same var multiple times', () => {
      beforeAll(() => {
         parse_result = P.parseSql('SELECT * FROM users where id = :name and blah = :blah and name = :name and test = :test and something = :test')
      })

      test('should replace the detected variables with postgres variable indexes', () => {
         expect(parse_result!.parameterized_sql).toEqual(
            'SELECT * FROM users where id = $1 and blah = $2 and name = $1 and test = $3 and something = $3'
         )
      })

      test('should return the mapping of postgres vars to names', () => {
         expect(parse_result!.mapping).toEqual([{ name: 'name', index: 1 }, { name: 'blah', index: 2 }, { name: 'test', index: 3 }])
      })
   })

   describe('type cast vars', () => {
      beforeAll(() => {
         parse_result = P.parseSql('SELECT * FROM users where id = :id::int and name = :name::text')
      })

      test('should replace the detected variables with postgres variable indexes', () => {
         expect(parse_result!.parameterized_sql).toEqual('SELECT * FROM users where id = $1::int and name = $2::text')
      })

      test('should return the mapping of postgres vars to names', () => {
         expect(parse_result!.mapping).toEqual([{ name: 'id', index: 1 }, { name: 'name', index: 2 }])
      })
   })

   describe('vars in a quoted string', () => {
      beforeAll(() => {
         parse_result = P.parseSql("SELECT * FROM users where created_on > '2011-01-01 10:00:00'::timestamptz")
      })

      test('should be ignored', () => {
         expect(parse_result!.parameterized_sql).toEqual("SELECT * FROM users where created_on > '2011-01-01 10:00:00'::timestamptz")
      })
   })

   describe('vars after comments with quotes', () => {
      test('should ignore single line comments', () => {
         const parsed = P.parseSql(`
            SELECT * FROM users
            -- Ignore all things who aren't after a certain date
            WHERE created_on > '2011-01-01 10:00:00'::timestamptz
         `)

         expect(parsed.parameterized_sql).toEqual(`
            SELECT * FROM users
            -- Ignore all things who aren't after a certain date
            WHERE created_on > '2011-01-01 10:00:00'::timestamptz
         `)
      })

      test('should ignore multi-line comments', () => {
         const parsed = P.parseSql(`
            SELECT * FROM users
            /* Ignore all things who aren't after a certain :date
             * More lines
             */
            WHERE created_on > '2011-01-01 10:00:00'::timestamptz
         `)

         expect(parsed.parameterized_sql).toEqual(`
            SELECT * FROM users
            /* Ignore all things who aren't after a certain :date
             * More lines
             */
            WHERE created_on > '2011-01-01 10:00:00'::timestamptz
         `)
      })
   })

   describe('comments in strings', () => {
      test('should ignore multi-line comments', () => {
         const parsed = P.parseSql(`
            SELECT * FROM users
            /* Ignore all things who aren't after a certain :date
             * More lines
             */
            WHERE some_text LIKE 'foo -- bar' AND :date::timestamptz
         `)

         expect(parsed.parameterized_sql).toEqual(`
            SELECT * FROM users
            /* Ignore all things who aren't after a certain :date
             * More lines
             */
            WHERE some_text LIKE 'foo -- bar' AND $1::timestamptz
         `)
      })

      test('should allow nested block comments', () => {
         const parsed = P.parseSql(`
            SELECT * FROM users
            /* Ignore all things who aren't after a certain :date
             * More lines /* nested block comment
             */*/
            WHERE some_text LIKE 'foo -- bar' AND :date::timestamptz
         `)

         expect(parsed.parameterized_sql).toEqual(`
            SELECT * FROM users
            /* Ignore all things who aren't after a certain :date
             * More lines /* nested block comment
             */*/
            WHERE some_text LIKE 'foo -- bar' AND $1::timestamptz
         `)
      })
   })

   describe('indexing objects', () => {
      beforeAll(() => {
         parse_result = P.parseSql('SELECT * FROM users where id = :id.foo and name = :name.bar')
      })

      test('should replace the detected variables with postgres variable indexes', () => {
         expect(parse_result!.parameterized_sql).toEqual('SELECT * FROM users where id = $1 and name = $2')
      })

      test('should return the mapping of postgres vars to names', () => {
         expect(parse_result!.mapping).toEqual([{ name: 'id.foo', index: 1 }, { name: 'name.bar', index: 2 }])
      })
   })

   describe('quoted ident syntax', () => {
      const unaltered_items = [`SELECT "addr:city" FROM "location";`]

      unaltered_items.forEach(sql => {
         test(`should not alter [${sql}]`, () => {
            expect(P.parseSql(sql).parameterized_sql).toEqual(sql)
         })
      })
   })

   describe('string constant syntax', () => {
      const unaltered_items = [
         `'Dianne'':not_a_parameter horse'`,
         `'Dianne'''':not_a_parameter horse'`,
         `SELECT ':not_an_parameter'`,
         `$$Dia:not_an_parameter's horse$$`,
         `$$Dianne's horse$$`, //  $function$`, //    END; //       RETURN ($1 ~ $q$:not_an_parameter$q$); //    BEGIN // `$function$
         `SELECT 'foo'
            'bar';
         `,
         `E'user\'s log'`,
         `$$escape ' with ''$$`,
      ]

      unaltered_items.forEach(sql => {
         test(`should not alter [${sql}]`, () => {
            expect(P.parseSql(sql).parameterized_sql).toEqual(sql)
         })
      })
   })

   describe('array slice syntax', () => {
      const unaltered_items = [
         `SELECT schedule[1:2][1:1] FROM sal_emp WHERE name = 'Bill';`,
         `SELECT f1[1][-2][3] AS e1, f1[1][-1][5] AS e2 FROM (SELECT '[1:1][-2:-1][3:5]={{{1,2,3},{4,5,6}}}'::int[] AS f1) AS ss;`,
         `SELECT array_dims(1 || '[0:1]={2,3}'::int[]);`,
      ]

      unaltered_items.forEach(sql => {
         test(`should not alter [${sql}]`, () => {
            expect(P.parseSql(sql).parameterized_sql).toEqual(sql)
         })
      })
   })

   describe('type cast', () => {
      const unaltered_items = [`select '1'   ::   numeric;`, `select '1'   ::  text :: numeric;`]

      unaltered_items.forEach(sql => {
         test(`should not alter [${sql}]`, () => {
            expect(P.parseSql(sql).parameterized_sql).toEqual(sql)
         })
      })
   })
})
