import { render } from '@testing-library/react';
import React from 'react';
import { CroppedImage } from './cropped_image';

const EXAMPLE_DATA_URI = `data:image/png;base64,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`;

it('Renders', () => {
  const { container } = render(
    <CroppedImage
      src={EXAMPLE_DATA_URI}
      alt="something"
      crop={{ x: 0, y: 0, width: 100, height: 100 }}
    />
  );
  expect(container).toMatchSnapshot();
});

it('Renders with style', () => {
  const { container } = render(
    <CroppedImage
      src={EXAMPLE_DATA_URI}
      alt="something"
      crop={{ x: 50, y: 50, width: 50, height: 50 }}
      style={{ margin: '3px' }}
    />
  );
  expect(container).toMatchSnapshot();
});
