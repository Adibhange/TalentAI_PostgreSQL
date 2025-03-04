import { db } from "../prisma";
import { inngest } from "./client";

import { GoogleGenerativeAI } from "@google/generative-ai";

interface SalaryRange {
  role: string;
  min: number;
  max: number;
  median: number;
  location: string;
}

if (!process.env.GEMINI_API_KEY) {
  throw new Error("GEMINI_API_KEY is not defined");
}
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

export const generateIndustryInsights = inngest.createFunction(
  { id: "generate-industry-insights", name: "Generate Industry Insights" },
  { cron: "0 0 * * 0" },
  async ({ step }) => {
    const industries = await step.run("Fetch industries", async () => {
      return await db.industryInsight.findMany({
        select: { industry: true },
      });
    });

    for (const { industry } of industries) {
      const prompt = `
                    Analyze the current state of the ${industry} industry and provide insights in ONLY the following JSON format without any additional notes or explanations:
                    {
                        "salaryRanges": [
                            { "role": "string", "min": number, "max": number, "median": number, "location": "string" }
                        ],
                        "growthRate": number,
                        "demandLevel": "HIGH" | "MEDUIM" | "LOW",
                        "topSkills": ["skill1", "skill2"],
                        "marketOutlook": "POSITIVE" | "NEUTRAL" | "NEGATIVE",
                        "keyTrends": ["trend1", "trend2"],
                        "recommendedSkills": ["skill1", "skill2"]
                    }
                    
                    IMPORTANT: Return ONLY the JSON. No additional text, notes, or markdown formatting.
                    Include at least 5 common roles for salary ranges.
                    Growth rate should be a percentage.
                    Include at least 5 skills and trends.
                `;

      const res = await step.ai.wrap(
        "gemini",
        async (p) => {
          return await model.generateContent(p);
        },
        prompt,
      );

      const textPart = res.response.candidates?.[0]?.content?.parts?.[0];
      const text = textPart && "text" in textPart ? textPart.text : "";
      const cleanedText = text.replace(/```(?:json)?\n?/g, "").trim();

      const insights = JSON.parse(cleanedText);

      console.log(insights.salaryRanges);

      await step.run(`Update ${industry} insights`, async () => {
        await db.salaryRange.deleteMany({
          where: { industryInsight: { industry } },
        });

        await db.industryInsight.update({
          where: { industry },
          data: {
            growthRate: insights.growthRate,
            demandLevel: insights.demandLevel,
            topSkills: insights.topSkills,
            marketOutlook: insights.marketOutlook,
            keyTrends: insights.keyTrends,
            recommendedSkills: insights.recommendedSkills,
            salaryRanges: {
              createMany: {
                data: insights.salaryRanges.map((range: SalaryRange) => ({
                  role: range.role,
                  min: range.min,
                  max: range.max,
                  median: range.median,
                  location: range.location,
                })),
              },
            },
            lastUpdated: new Date(),
            nextUpdate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          },
        });
      });
    }
  },
);
