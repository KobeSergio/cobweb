export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      collections: {
        Row: {
          chain_id: number | null
          contract_address: string | null
          created_at: string
          description: string
          id: string
          max_supply: number
          name: string
          owner_id: string
          project_type: Database['public']['Enums']['project_type']
          slug: string | null
          slug_reserved_at: string | null
          status: Database['public']['Enums']['collection_status']
          symbol: string
          updated_at: string
        }
        Insert: {
          chain_id?: number | null
          contract_address?: string | null
          created_at?: string
          description?: string
          id?: string
          max_supply: number
          name: string
          owner_id?: string
          project_type: Database['public']['Enums']['project_type']
          slug?: string | null
          slug_reserved_at?: string | null
          status?: Database['public']['Enums']['collection_status']
          symbol: string
          updated_at?: string
        }
        Update: {
          chain_id?: number | null
          contract_address?: string | null
          created_at?: string
          description?: string
          id?: string
          max_supply?: number
          name?: string
          owner_id?: string
          project_type?: Database['public']['Enums']['project_type']
          slug?: string | null
          slug_reserved_at?: string | null
          status?: Database['public']['Enums']['collection_status']
          symbol?: string
          updated_at?: string
        }
        Relationships: []
      }
      mint_groups: {
        Row: {
          collection_id: string
          created_at: string
          id: string
          max_supply: number
          name: string
          onchain_id: number
          price_wei: number
          start_at: string | null
          updated_at: string
        }
        Insert: {
          collection_id: string
          created_at?: string
          id?: string
          max_supply?: number
          name: string
          onchain_id: number
          price_wei?: number
          start_at?: string | null
          updated_at?: string
        }
        Update: {
          collection_id?: string
          created_at?: string
          id?: string
          max_supply?: number
          name?: string
          onchain_id?: number
          price_wei?: number
          start_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'mint_groups_collection_id_fkey'
            columns: ['collection_id']
            isOneToOne: false
            referencedRelation: 'collections'
            referencedColumns: ['id']
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          id: string
          wallet_address: string
        }
        Insert: {
          created_at?: string
          id: string
          wallet_address: string
        }
        Update: {
          created_at?: string
          id?: string
          wallet_address?: string
        }
        Relationships: []
      }
      whitelist_entries: {
        Row: {
          collection_id: string
          created_at: string
          mint_group_id: string
          quota: number
          wallet_address: string
        }
        Insert: {
          collection_id: string
          created_at?: string
          mint_group_id: string
          quota: number
          wallet_address: string
        }
        Update: {
          collection_id?: string
          created_at?: string
          mint_group_id?: string
          quota?: number
          wallet_address?: string
        }
        Relationships: [
          {
            foreignKeyName: 'whitelist_entries_collection_id_fkey'
            columns: ['collection_id']
            isOneToOne: false
            referencedRelation: 'collections'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'whitelist_entries_mint_group_id_fkey'
            columns: ['mint_group_id']
            isOneToOne: false
            referencedRelation: 'mint_groups'
            referencedColumns: ['id']
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      reserve_slug: {
        Args: { p_collection_id: string; p_slug: string }
        Returns: undefined
      }
    }
    Enums: {
      collection_status: 'draft' | 'art_locked' | 'rendering' | 'rendered' | 'deployed'
      project_type: 'generative' | 'one_of_one' | 'metadata' | 'single_asset'
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, 'public'>]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    keyof (DefaultSchema['Tables'] & DefaultSchema['Views']) | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] & DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema['Enums'] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema['CompositeTypes'] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      collection_status: ['draft', 'art_locked', 'rendering', 'rendered', 'deployed'],
      project_type: ['generative', 'one_of_one', 'metadata', 'single_asset'],
    },
  },
} as const
