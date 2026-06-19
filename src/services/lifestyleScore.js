const SCORE_WEIGHTS = {
  DIET: {
    'Very healthy': 1.0,
    'Moderately healthy': 0.6,
    'Poor': 0.3
  },
  EXERCISE: {
    0: 0.2,
    1: 0.3,
    2: 0.4,
    3: 0.5,
    4: 0.6,
    5: 0.7,
    6: 0.8,
    7: 1.0
  },
  ALCOHOL: {
    'Rarely / Never': 1.0,
    'Occasionally': 0.6,
    'Regularly': 0.3
  },
  SLEEP: {
    '7 - 8': 1.0,
    '5 - 6': 0.6,
    '< 5': 0.3
  },
  STRESS: {
    0: 1.0,
    1: 0.9,
    2: 0.8,
    3: 0.7,
    4: 0.6,
    5: 0.5,
    6: 0.4,
    7: 0.3,
    8: 0.2,
    9: 0.1,
    10: 0.0
  },
  SUNLIGHT: {
    'Daily': 1.0,
    'Sometimes': 0.6,
    'Regularly': 0.3
  },
  SMOKING: {
    true: 0.2,
    false: 1.0
  },
  SUPPLEMENTS: {
    true: 1.0,
    false: 0.7
  }
};

const SPERM_COUNT_RANGES = {
  OPTIMAL: 40,
  NORMAL: 15,
  LOW: 5,
  VERY_LOW: 1
};

const calculateSpermCountScore = (spermCount) => {
  if (spermCount >= SPERM_COUNT_RANGES.OPTIMAL) return 1.0;
  if (spermCount >= SPERM_COUNT_RANGES.NORMAL) return 0.7;
  if (spermCount >= SPERM_COUNT_RANGES.LOW) return 0.4;
  if (spermCount >= SPERM_COUNT_RANGES.VERY_LOW) return 0.2;
  return 0.1;
};

const calculateFactorScores = (onboardingData) => {
  const rawScores = {
    diet: SCORE_WEIGHTS.DIET[onboardingData.diet] || 0,
    exercise: SCORE_WEIGHTS.EXERCISE[onboardingData.exerciseDays] || 0,
    alcohol: SCORE_WEIGHTS.ALCOHOL[onboardingData.alcohol] || 0,
    sleep: SCORE_WEIGHTS.SLEEP[onboardingData.sleep] || 0,
    stress: SCORE_WEIGHTS.STRESS[onboardingData.stress] || 0,
    sunlight: SCORE_WEIGHTS.SUNLIGHT[onboardingData.sunlightExposure] || 0,
    smoking: SCORE_WEIGHTS.SMOKING[onboardingData.smoke] || 0,
    supplements: SCORE_WEIGHTS.SUPPLEMENTS[onboardingData.supplements] || 0
  };

  if (onboardingData.hadTest && onboardingData.spermCount) {
    rawScores.spermCount = calculateSpermCountScore(onboardingData.spermCount);
  }

  const scores = Object.entries(rawScores).reduce((acc, [key, value]) => {
    acc[key] = parseFloat((value * 100).toFixed(0));
    return acc;
  }, {});

  const overallScore = parseFloat((Object.values(scores).reduce((sum, score) => sum + score, 0) / Object.keys(scores).length).toFixed(0));

  return {
    factorScores: scores,
    overallScore
  };
};

const calculateTestosteroneImpact = (overallScore) => {
  const scoreDecimal = overallScore / 100;
  
  const baseDeclineRate = 1.0;
  
  const impactMultiplier = 2 - scoreDecimal;
  const yearlyDeclineRate = baseDeclineRate * impactMultiplier;
  
  return {
    yearlyDeclineRate: parseFloat(yearlyDeclineRate.toFixed(1)),
    impactMultiplier: parseFloat(impactMultiplier.toFixed(2))
  };
};

const generateFactorDescriptions = (scores) => {
  return {
    diet: getDescription('Diet', scores.diet),
    exercise: getDescription('Exercise', scores.exercise),
    alcohol: getDescription('Alcohol', scores.alcohol),
    sleep: getDescription('Sleep', scores.sleep),
    stress: getDescription('Stress', scores.stress),
    sunlight: getDescription('Sunlight', scores.sunlight),
    smoking: getDescription('Smoking', scores.smoking),
    supplements: getDescription('Supplements', scores.supplements)
  };
};

const getDescription = (factor, score) => {
  if (score >= 80) return `${factor} - Excellent`;
  if (score >= 60) return `${factor} - Good`;
  if (score >= 40) return `${factor} - Moderate`;
  return `${factor} - Needs Improvement`;
};

const generateRecommendations = (scores, onboardingData) => {
  const recommendations = [];

  if (scores.diet < 70) {
    recommendations.push('Consider improving your diet with more whole foods and reducing processed foods');
  }
  if (scores.exercise < 60) {
    recommendations.push('Try to increase your exercise frequency to at least 3-4 times per week');
  }
  if (scores.alcohol < 70) {
    recommendations.push('Consider reducing alcohol consumption to improve testosterone levels');
  }
  if (scores.sleep < 70) {
    recommendations.push('Aim for 7-8 hours of quality sleep per night');
  }
  if (scores.stress < 60) {
    recommendations.push('Implement stress management techniques like meditation or deep breathing');
  }
  if (scores.sunlight < 70) {
    recommendations.push('Try to get more daily sunlight exposure for vitamin D synthesis');
  }
  if (scores.smoking < 70) {
    recommendations.push('Consider quitting smoking as it can significantly impact fertility and testosterone levels');
  }
  if (scores.supplements < 70) {
    recommendations.push('Consider taking fertility supplements to support reproductive health');
  }

  if (onboardingData.hadTest && onboardingData.spermCount) {
    if (onboardingData.spermCount < SPERM_COUNT_RANGES.NORMAL) {
      recommendations.push('Your sperm count is below normal range. Consider consulting with a fertility specialist');
    }
    if (onboardingData.spermCount < SPERM_COUNT_RANGES.OPTIMAL && scores.diet < 80) {
      recommendations.push('Optimize your diet with fertility-boosting foods like zinc-rich foods and antioxidants');
    }
    if (onboardingData.spermCount < SPERM_COUNT_RANGES.OPTIMAL && scores.exercise < 70) {
      recommendations.push('Regular exercise can help improve sperm quality and count');
    }
  }

  return recommendations;
};

export const calculateLifestyleScore = (onboardingData) => {
  try {
    const { factorScores, overallScore } = calculateFactorScores(onboardingData);
    
    const { yearlyDeclineRate, impactMultiplier } = calculateTestosteroneImpact(overallScore);
    
    const factorDescriptions = generateFactorDescriptions(factorScores);

    return {
      overallScore,
      yearlyDeclineRate,
      impactMultiplier,
      factorScores,
      factorDescriptions,
      recommendations: generateRecommendations(factorScores, onboardingData)
    };
  } catch (error) {
    console.error('Error calculating lifestyle score:', error);
    throw new Error('Failed to calculate lifestyle score');
  }
}; 