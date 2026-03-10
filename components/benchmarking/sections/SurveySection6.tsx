"use client";

import {
  SectionHeading,
  CurrencyField,
  type SurveySectionProps,
} from "../SurveyFields";

export default function SurveySection6(props: SurveySectionProps) {
  return (
    <div>
      <SectionHeading
        title="6. General Merchandise"
        description="Report revenue for non-course-material product categories."
      />

      <div className="grid md:grid-cols-2 gap-x-6">
        <CurrencyField
          label="Course-Required Supplies (Total)"
          field="sales_course_supplies"
          {...props}
        />
        <CurrencyField
          label="Course-Required Supplies (Online)"
          field="sales_course_supplies_online"
          {...props}
        />
      </div>

      <div className="border-t border-gray-200 pt-6 mt-4">
        <h3 className="text-sm font-semibold text-gray-700 mb-4">
          Product Categories
        </h3>

        <CurrencyField
          label="General / Trade Books"
          field="sales_general_books"
          {...props}
        />

        <CurrencyField
          label="Technology"
          field="sales_technology"
          {...props}
        />

        <CurrencyField
          label="Stationery"
          field="sales_stationary"
          {...props}
        />

        <div className="grid md:grid-cols-2 gap-x-6">
          <CurrencyField
            label="Apparel (Total)"
            field="sales_apparel"
            {...props}
          />
          <div className="grid grid-cols-2 gap-x-4">
            <CurrencyField
              label="Imprinted"
              field="sales_apparel_imprint"
              {...props}
            />
            <CurrencyField
              label="Non-Imprinted"
              field="sales_apparel_non_imprint"
              {...props}
            />
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-x-6">
          <CurrencyField
            label="Gifts & Drinkware (Total)"
            field="sales_gifts_drinkware"
            {...props}
          />
          <div className="grid grid-cols-2 gap-x-4">
            <CurrencyField
              label="Imprinted"
              field="sales_gifts_imprint"
              {...props}
            />
            <CurrencyField
              label="Non-Imprinted"
              field="sales_gifts_non_imprint"
              {...props}
            />
          </div>
        </div>

        <CurrencyField
          label="Custom / Licensed Merchandise"
          field="sales_custom_merch"
          {...props}
        />

        <CurrencyField
          label="Food & Beverage"
          field="sales_food_beverage"
          {...props}
        />
      </div>
    </div>
  );
}
